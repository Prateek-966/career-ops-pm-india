#!/usr/bin/env node
/**
 * prescore.mjs — zero-LLM triage score, so a large scan arrives ranked.
 *
 * ── What this is for, and what it is NOT ──────────────────────────────────
 *
 * A wide ATS sweep returns hundreds of rows. Evaluating each one properly
 * (`modes/oferta.md`: Blocks A-G, PM dimensions, GCC classification) costs
 * tokens and minutes, so it is only ever run on a chosen few. The problem is
 * choosing: without a cheap ordering you either evaluate arbitrarily or skim
 * titles by eye, and both waste the expensive step on roles that never had a
 * chance.
 *
 * This produces that ordering. It is deliberately shallow, deterministic and
 * free — regex and set arithmetic over the title, the JD body when one is
 * available, and `cv.md`.
 *
 * **It is a triage rank, never a fit verdict.** The bands are named for what
 * you should DO ("review first", "worth a look") rather than for how good the
 * role is, because a number that reads as a judgement gets treated as one. A
 * commercial job-search tool showing "89% match" on a card invites exactly that
 * mistake: the percentage is a ranking artefact, and the actual reason to apply
 * or not lives in the evaluation. Nothing here replaces the rubric.
 *
 * ── Two confidence tiers, reported not blended ───────────────────────────
 *
 * At scan time a row is usually just {title, company, location} — the ATS
 * listing endpoints return no body. With a JD capture there is much more to go
 * on. Scoring both at once and pretending they are comparable is how a coarse
 * guess acquires false authority, so `confidence` is returned alongside and the
 * weights differ:
 *
 *   title-only  archetype 60 · seniority 25 · market 15
 *   full-jd     archetype 40 · seniority 20 · market 10 · skills 30
 *
 * ── The years bar is weighted deliberately heavily ───────────────────────
 *
 * The 2026-08-26 calibration run (evals/india-pm/RESULTS-2026-08-26.md) found
 * that the binding constraint on this candidate is PM TENURE, not domain: JFrog
 * (12+ years industry / 6+ PM) and Freshworks (9+ dedicated PM years) both came
 * in at 3.0 despite strong domain fit, against ~3.6 years in PM-titled roles.
 * Both had been predicted as >= 4 from the posting.
 *
 * So an explicit years requirement in the JD is not a minor signal here — it is
 * the one that most often decides the outcome, and it is cheaply extractable.
 * Surfacing it in triage puts the real blocker in front of the candidate before
 * they spend an evaluation on a role whose first filter they do not clear.
 *
 * Usage:
 *   node prescore.mjs --title "Senior Product Manager" --location "Pune, India"
 *   node prescore.mjs --title "Staff PM" --jd jds/acme.md --summary
 *   node prescore.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { marketOf, UNKNOWN_MARKET } from './market-map.mjs';
import { extractJdSkills, classifySkillGaps } from './jd-skill-gap.mjs';
// NOTE: scan-ingest.mjs is deliberately NOT imported at module scope. It
// imports this file (to score rows as they are ingested), so a static import
// back would be a cycle. The only place prescore needs the title filter is its
// own CLI, which loads it dynamically below; the ingest path passes an already
// built `matchesTitle` through ctx and never touches scan-ingest from here.

export const BANDS = [
  { min: 70, id: 'review_first', label: 'Review first' },
  { min: 50, id: 'worth_a_look', label: 'Worth a look' },
  { min: 30, id: 'low', label: 'Low' },
  { min: 0, id: 'skip', label: 'Probably skip' },
];

/**
 * Weighted average over the signals that were actually available, scaled to
 * 0-100. Returns 50 (mid-band, "we don't know") when nothing is available,
 * rather than 0 — which would rank an unknown role below a known-bad one.
 *
 * @param {Array<{norm: number, weight: number}>} parts
 */
export function weightedAverage(parts, totalPossibleWeight = 100) {
  const available = parts.reduce((a, p) => a + p.weight, 0);
  if (available === 0) return 50;
  const raw = (parts.reduce((a, p) => a + p.norm * p.weight, 0) / available) * 100;

  // Shrink toward the neutral midpoint in proportion to how much of the
  // scoring weight was actually available.
  //
  // Without this, dropping a signal makes the score MORE extreme rather than
  // less certain: a bare "Senior Product Manager" with no domain word scored a
  // perfect 100, because the two signals left (seniority, market) both maxed
  // out and there was nothing to average them against. A row we know least
  // about was ranking above every row we know well, which is precisely
  // backwards for a triage list.
  //
  // With 40% of the weight present you get 40% of the distance from neutral.
  // Full information gives the full spread.
  const confidenceRatio = Math.min(1, available / totalPossibleWeight);
  return 50 + (raw - 50) * confidenceRatio;
}

/** @param {number} score */
export function bandFor(score) {
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
}

/**
 * Archetype ladder from config/profile.yml, lowest-cost read possible.
 * Absent file or absent block is not an error: the scorer degrades to
 * seniority + market rather than refusing to rank anything.
 *
 * @param {string} [profilePath]
 * @returns {Array<{name: string, fit: string, tokens: string[]}>}
 */
export function loadArchetypes(profilePath = 'config/profile.yml') {
  if (!existsSync(profilePath)) return [];
  let doc;
  try {
    doc = yaml.load(readFileSync(profilePath, 'utf-8'));
  } catch {
    return [];
  }
  const list = doc?.target_roles?.archetypes;
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a.name === 'string')
    .map((a) => ({
      name: a.name,
      fit: String(a.fit || 'adjacent').toLowerCase(),
      // "Supply Chain / SCM Product Manager" → the distinguishing words only.
      // "product" and "manager" are dropped: they appear in every archetype and
      // in every title the filter let through, so matching on them would score
      // every row identically and rank nothing.
      tokens: a.name
        .toLowerCase()
        .split(/[^a-z0-9+]+/)
        .filter((t) => t && !['product', 'manager', 'management', 'and', 'or'].includes(t)),
    }));
}

const FIT_POINTS = { primary: 1, secondary: 0.72, adjacent: 0.5 };

/**
 * Best archetype match for a title, or null.
 * @param {string} title
 * @param {ReturnType<loadArchetypes>} archetypes
 */
export function archetypeMatch(title, archetypes) {
  const t = normalizeTitle(title).toLowerCase();
  let best = null;
  for (const a of archetypes) {
    if (!a.tokens.length) continue;
    const hits = a.tokens.filter((tok) => t.includes(tok));
    if (!hits.length) continue;
    const coverage = hits.length / a.tokens.length;
    const weight = (FIT_POINTS[a.fit] ?? 0.5) * coverage;
    if (!best || weight > best.weight) best = { name: a.name, fit: a.fit, matched: hits, coverage, weight };
  }
  return best;
}

// Ordered most-specific first: "associate product manager" must not read as
// senior because it contains no senior word, and "senior associate" (PwC's
// grade) must not read as senior either — it is a consultancy rank, not a
// product seniority.
const SENIORITY_PATTERNS = [
  { id: 'intern', re: /\b(intern|internship|trainee|graduate|apprentice)\b/i, points: 0 },
  { id: 'entry', re: /\b(associate|junior|jr\.?|entry[- ]level)\b/i, points: 0.15 },
  { id: 'exec', re: /\b(vp|vice president|head of|director|chief)\b/i, points: 0.55 },
  { id: 'lead', re: /\b(principal|staff|lead|group)\b/i, points: 0.9 },
  { id: 'senior', re: /\b(senior|sr\.?)\b/i, points: 1 },
];

/**
 * Normalize a raw ATS title for word-boundary matching.
 *
 * Underscore is a WORD character in JS regex, so `\bassociate\b` does not
 * match inside "Senior Associate_Product Manager" — there is no boundary
 * between "e" and "_". PwC's real posting in the calibration set is
 * `IN_Senior Associate_Product Manager - AI Products__GCC_Advisory_Bangalore`,
 * and it silently read as SENIOR rather than as the entry-grade consultancy
 * rank it is: exactly the row that should rank low, ranking high.
 *
 * @param {string} title
 */
export function normalizeTitle(title) {
  return String(title || '').replace(/[_/|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** @param {string} title */
export function seniorityOf(title) {
  const t = normalizeTitle(title);
  for (const p of SENIORITY_PATTERNS) if (p.re.test(t)) return { id: p.id, points: p.points };
  return { id: 'mid', points: 0.6 };
}

// "8+ years", "5-7 years", "minimum 6 years", "9+ years of dedicated SaaS
// product management". Captures the LOWEST number in a range, which is the
// bar actually being set.
const YEARS_RE = /\b(\d{1,2})\s*(?:\+|\s*-\s*\d{1,2})?\s*(?:\+)?\s*years?\b/gi;

/**
 * Highest years-of-experience bar stated anywhere in a JD, or null.
 *
 * Highest, not first: a JD often opens with a soft "3+ years in a technical
 * field" and states the real bar ("9+ years of dedicated SaaS product
 * management") much later. Taking the first match reads the easy one and
 * misses the one that filters you out.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function yearsRequired(text) {
  const src = String(text || '');
  let max = null;
  for (const m of src.matchAll(YEARS_RE)) {
    const n = Number(m[1]);
    // 30+ is almost always a company age ("25 years of innovation"), not a
    // requirement. Cap the plausible range rather than trusting every number.
    if (!Number.isFinite(n) || n < 1 || n > 25) continue;
    if (max === null || n > max) max = n;
  }
  return max;
}

/**
 * Score one role. Zero LLM, deterministic, safe to run over thousands of rows.
 *
 * @param {{title: string, company?: string, location?: string, description?: string}} role
 * @param {{archetypes?: any[], cvText?: string, pmYears?: number}} [ctx]
 */
export function scoreRole(role, ctx = {}) {
  const archetypes = ctx.archetypes || [];
  const title = String(role?.title || '');
  const description = String(role?.description || '');
  const hasJd = description.trim().length > 200;

  const signals = [];

  // Defence in depth against a non-role. In the normal path portals.yml's
  // title filter rejects these long before ingestion, so the scorer only ever
  // sees titles that already passed — but relying on that silently means the
  // day something calls scoreRole() directly, "Warehouse Forklift Operator"
  // comes back "Worth a look" because it reads as a mid-level role in India.
  // An unranked row is recoverable; a confidently mis-ranked one is not.
  //
  // Uses the SAME filter the scanner uses, so the two can never disagree about
  // what counts as a PM title. Absent filter (no portals.yml) skips the check
  // rather than failing closed — a missing config should not silently zero
  // every score.
  if (typeof ctx.matchesTitle === 'function' && !ctx.matchesTitle(title)) {
    return {
      score: 0,
      band: bandFor(0),
      confidence: 'rejected',
      market: marketOf(role?.location || ''),
      signals: ['does not pass the portals.yml title filter — not a targeted role'],
    };
  }

  const arch = archetypeMatch(title, archetypes);
  const sen = seniorityOf(title);
  const market = marketOf(role?.location || '');

  // An absent domain word is NOT a bad domain. Most strong PM titles are
  // generic — "Lead Product Manager", "Senior Product Manager" — and carry
  // their domain in the JD body, not the title. Scoring the absence as a low
  // match ranked the two best roles in the calibration set (Nielsen 4.5, QAD
  // 4.5) as "Low", which is the exact mistake modes/_custom.md forbids:
  // "never auto-downgraded for being unlisted".
  //
  // So archetype becomes an UNAVAILABLE signal rather than a zero one, and the
  // score is a weighted average over the signals actually present.
  const archAvailable = Boolean(arch);
  const archNorm = arch ? Math.min(1, arch.weight) : 0;
  if (arch) signals.push(`archetype: ${arch.name} (${arch.fit})`);
  else signals.push('archetype: not stated in the title — not counted against it; the JD decides');

  signals.push(`seniority: ${sen.id}`);
  if (sen.id === 'intern' || sen.id === 'entry') {
    signals.push('⚠ junior title — below the candidate\'s level');
  }

  const marketNorm = market === UNKNOWN_MARKET ? 0.35 : 1;
  signals.push(`market: ${market}`);

  let score;
  let confidence;

  // Weighted average over AVAILABLE signals. A missing signal shrinks the
  // denominator instead of contributing zero, so "we don't know" never reads
  // as "we know it's bad".
  /** @type {Array<{norm: number, weight: number}>} */
  const parts = [];
  const add = (norm, weight, available = true) => { if (available) parts.push({ norm, weight }); };

  if (hasJd) {
    confidence = 'full-jd';
    // Same rule as archetype: an unextractable skill list is an ABSENT signal,
    // not a middling one. Contributing a silent 0.5 at weight 30 let a third of
    // the score be an invented neutral that nothing in the signals disclosed —
    // the JFrog JD hit exactly that, and the output gave no hint of it.
    let skillNorm = null;
    try {
      const jdSkills = extractJdSkills(description);
      if (jdSkills.length && ctx.cvText) {
        const cls = classifySkillGaps(jdSkills, ctx.cvText);
        const covered = (cls.existing?.length || 0) + (cls.supportedByResume?.length || 0);
        const total = covered + (cls.gap?.length || 0);
        if (total > 0) {
          skillNorm = covered / total;
          signals.push(`skills: ${covered}/${total} required skills covered by cv.md`);
        }
      }
      if (skillNorm === null) {
        signals.push('skills: no explicit requirement list found in this JD — not scored');
      }
    } catch {
      signals.push('skills: classification failed — not scored');
    }

    add(archNorm, 40, archAvailable);
    add(sen.points, 20);
    add(marketNorm, 10);
    add(skillNorm ?? 0, 30, skillNorm !== null);
    score = weightedAverage(parts, 100); // 40 + 20 + 10 + 30

    // The years bar. Applied as a penalty rather than folded into a weight so
    // it is visible in the signals rather than silently depressing a number —
    // per the calibration run, this is the single most frequent real blocker.
    const req = yearsRequired(description);
    if (req !== null) {
      const have = Number.isFinite(ctx.pmYears) ? ctx.pmYears : null;
      if (have !== null && req > have) {
        const shortfall = req - have;
        const penalty = Math.min(25, shortfall * 4);
        score -= penalty;
        signals.push(`⚠ asks ${req}+ years, profile evidences ~${have} — short by ${shortfall} (−${Math.round(penalty)})`);
      } else {
        signals.push(`years: asks ${req}+${have !== null ? `, profile ~${have} — clears it` : ''}`);
      }
    }
  } else {
    confidence = 'title-only';
    add(archNorm, 60, archAvailable);
    add(sen.points, 25);
    add(marketNorm, 15);
    score = weightedAverage(parts, 100); // 60 + 25 + 15
    signals.push('no JD body — scored from the title alone, treat as coarse');
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return { score: bounded, band: bandFor(bounded), confidence, market, signals };
}

// ── CLI ───────────────────────────────────────────────────────────────────

function readCv(path = 'cv.md') {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

/**
 * Years in PM-titled roles, from config/profile.yml when declared.
 * Never inferred from cv.md dates — the calibration run found three
 * overlapping ranges there, so a computed figure would be wrong and confidently
 * so. Absent means the years check reports the bar without judging it.
 */
function pmYearsFromProfile(profilePath = 'config/profile.yml') {
  if (!existsSync(profilePath)) return null;
  try {
    const doc = yaml.load(readFileSync(profilePath, 'utf-8'));
    const v = doc?.experience?.pm_years;
    return Number.isFinite(Number(v)) ? Number(v) : null;
  } catch { return null; }
}

function selfTest() {
  const archetypes = loadArchetypes();
  let failed = 0;
  const check = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) failed++; };

  check('loads the archetype ladder', archetypes.length > 0);
  check('"Data Product Manager" matches a primary archetype',
    archetypeMatch('Senior Data Product Manager', archetypes)?.fit === 'primary');
  check('an unrelated title matches nothing',
    archetypeMatch('Warehouse Forklift Operator', archetypes) === null);
  check('seniority: intern', seniorityOf('Product Manager Intern').id === 'intern');
  check('seniority: entry beats senior for "Associate"', seniorityOf('Associate Product Manager').id === 'entry');
  check('seniority: lead', seniorityOf('Staff Product Manager').id === 'lead');
  check('yearsRequired takes the HIGHEST bar', yearsRequired('3+ years technical. 9+ years of PM.') === 9);
  check('yearsRequired ignores company age', yearsRequired('50 years of innovation. 5+ years PM.') === 5);
  check('yearsRequired null when absent', yearsRequired('No bar stated here.') === null);

  const senior = scoreRole({ title: 'Senior Data Product Manager', location: 'Pune, India' }, { archetypes });
  const intern = scoreRole({ title: 'Product Manager Intern', location: 'Pune, India' }, { archetypes });
  check('a matching senior role outranks an intern one', senior.score > intern.score);
  check('title-only is reported as such', senior.confidence === 'title-only');

  const overBar = scoreRole(
    { title: 'Staff Product Manager', location: 'Hyderabad, India', description: 'x'.repeat(250) + ' We require 9+ years of dedicated SaaS product management experience.' },
    { archetypes, pmYears: 3.6 },
  );
  check('an over-bar years requirement is penalised and named',
    overBar.signals.some((s) => /short by/.test(s)));
  check('full-jd confidence when a body is present', overBar.confidence === 'full-jd');

  const reject = () => false;
  const forklift = scoreRole({ title: 'Warehouse Forklift Operator', location: 'Pune, India' }, { archetypes, matchesTitle: reject });
  check('a title the filter rejects scores 0, not "worth a look"', forklift.score === 0 && forklift.confidence === 'rejected');
  const noFilter = scoreRole({ title: 'Senior Product Manager', location: 'Pune, India' }, { archetypes });
  check('an absent title filter skips the check rather than zeroing everything', noFilter.score > 0);

  console.log(failed === 0 ? '\n🟢 prescore self-test passed' : `\n🔴 ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i === -1 ? null : argv[i + 1]; };
  if (argv.includes('--self-test')) return selfTest();

  const title = arg('--title');
  if (!title) {
    console.error('Usage: node prescore.mjs --title "<title>" [--location "<loc>"] [--jd <file>] [--summary]');
    process.exit(1);
  }
  const jdPath = arg('--jd');
  const description = jdPath && existsSync(jdPath) ? readFileSync(jdPath, 'utf-8') : '';
  let matchesTitle = null;
  try {
    ({ loadTitleFilter: matchesTitle } = await import('./scan-ingest.mjs'));
    matchesTitle = matchesTitle();
  } catch { matchesTitle = null; /* no portals.yml — skip the check */ }

  const result = scoreRole(
    { title, company: arg('--company') || '', location: arg('--location') || '', description },
    { archetypes: loadArchetypes(), cvText: readCv(), pmYears: pmYearsFromProfile(), matchesTitle },
  );

  if (argv.includes('--summary')) {
    console.log(`\n${title}`);
    console.log(`  ${result.score}/100 — ${result.band.label}  (${result.confidence})`);
    for (const s of result.signals) console.log(`    · ${s}`);
    console.log('\n  Triage rank only. The evaluation decides whether to apply.\n');
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
