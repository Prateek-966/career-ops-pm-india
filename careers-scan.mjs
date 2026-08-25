#!/usr/bin/env node

/**
 * careers-scan.mjs — company career pages that no supported ATS covers
 * (PRD v2 §B4, Tier 3).
 *
 * ── The gap this fills ────────────────────────────────────────────────────
 *
 * Tier 2 (`discover-ats.mjs` -> `portals.yml` -> `scan.mjs`) reaches any company
 * whose careers page runs on Greenhouse, Lever, Ashby, Workday, SmartRecruiters
 * and friends. That is most of them, and it is the backbone.
 *
 * It is not all of them. Mid-size Indian companies commonly run a custom career
 * portal or Zoho Recruit, which `discover-ats.mjs` cannot detect and `scan.mjs`
 * cannot fetch. Those companies are invisible to every other tier, and some of
 * them are exactly the enterprise-B2B, supply-chain and platform employers this
 * search is aimed at.
 *
 * ── Why this is safe, and stays safe ──────────────────────────────────────
 *
 * The PRD scopes this tier tightly, and the tool available here makes the scope
 * structural rather than a matter of discipline: Firecrawl exposes SEARCH
 * (`firecrawl_search`, with `includeDomains`), not a crawler. So a sweep is a
 * domain-restricted search of one company's own site, not a walk of it. There
 * is no open-ended crawling to accidentally do.
 *
 * Four scope rules, all enforced HERE in code rather than trusted to the caller:
 *
 *   1. The company must be on the seed list. Never an arbitrary domain.
 *   2. The company must have NO tenant in portals.yml. If Tier 2 already
 *      reaches it, this tier must not also add it — that is how a role gets
 *      into the inbox twice under two provenances.
 *   3. The result URL must be on an employer domain. An aggregator or ATS host
 *      is refused outright: an ATS-hosted hit means Tier 2's probe missed a
 *      tenant, and the fix is to seed that tenant, not to launder the posting
 *      through Tier 3.
 *   4. Never Naukri or LinkedIn, by any route. Covered by rule 3, and asserted
 *      separately in the tests because it is the rule most worth not losing.
 *
 * Rate limiting and caching are the caller's business (see modes/careers-scan.md:
 * re-crawl weekly at most), because the search itself happens at the agent layer.
 *
 * ── Untrusted input ───────────────────────────────────────────────────────
 *
 * Search results are web content. Per AGENTS.md they are data, never
 * instructions. Every field is validated rather than trusted.
 *
 * Usage:
 *   node careers-scan.mjs --stdin < results.json
 *   node careers-scan.mjs results.json [--dry-run]
 *   node careers-scan.mjs --list-targets      # which companies this tier covers
 *   node careers-scan.mjs --help
 *
 * Input JSON: an array, or { results|data|rows|items: [...] }. Each row:
 *   {
 *     "company":  "Acme",                          // required, must be seeded
 *     "title":    "Senior Product Manager",         // required
 *     "url":      "https://acme.com/careers/123",   // required, employer domain
 *     "location": "Pune, India",                    // optional
 *     "postedAt": "2026-08-21",                     // optional, never guessed
 *     "salary":   "..."                             // optional, VERBATIM
 *   }
 */

import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';

import { ingest, loadTitleFilter, localToday } from './scan-ingest.mjs';
import { UNKNOWN_MARKET } from './market-map.mjs';
import { isNonEmployerHost, companyKey } from './add-company.mjs';
import { loadDedupSnapshot, appendToPipeline, appendToScanHistory } from './scan.mjs';

const SOURCE_TIER = 'firecrawl';
const SEED_PATH = 'config/india-seed-companies.yml';
const PORTALS_PATH = 'portals.yml';

const USAGE = `careers-scan.mjs — career pages with no supported ATS (PRD v2 §B4, Tier 3)

Usage:
  node careers-scan.mjs --stdin [--dry-run]
  node careers-scan.mjs <results.json> [--dry-run]
  node careers-scan.mjs --list-targets
  node careers-scan.mjs --help

Reads domain-restricted search results, enforces the Tier 3 scope rules, then
applies the same title filter and dedupe as every other tier.

--list-targets prints the companies this tier is allowed to cover: seeded, and
with no tenant in portals.yml. Feed those to firecrawl_search one at a time.`;

/**
 * Companies on the seed list, keyed for comparison.
 * @param {string} [seedPath]
 * @returns {Map<string, {name: string, website?: string}>}
 */
export function loadSeedCompanies(seedPath = SEED_PATH) {
  if (!existsSync(seedPath)) {
    throw new Error(
      `${seedPath} not found — Tier 3 is scoped to seed-list companies. `
      + 'Run `npm run setup:pm-india` first.',
    );
  }
  const doc = yaml.load(readFileSync(seedPath, 'utf8'));
  const list = Array.isArray(doc?.companies) ? doc.companies : [];
  const out = new Map();
  for (const c of list) {
    const key = companyKey(c?.name);
    if (key) out.set(key, { name: c.name, website: c.website });
  }
  return out;
}

/**
 * Company names that already have a tenant in portals.yml — i.e. Tier 2 reaches
 * them, so Tier 3 must not.
 * @param {string} [portalsPath]
 * @returns {Set<string>}
 */
export function loadCoveredCompanies(portalsPath = PORTALS_PATH) {
  const out = new Set();
  if (!existsSync(portalsPath)) return out;
  const cfg = yaml.load(readFileSync(portalsPath, 'utf8'));
  const tracked = Array.isArray(cfg?.tracked_companies) ? cfg.tracked_companies : [];
  for (const t of tracked) {
    const key = companyKey(t?.name);
    if (key) out.add(key);
  }
  return out;
}

/**
 * The companies this tier may cover: seeded, and not already reached by Tier 2.
 * @param {Map<string, {name: string, website?: string}>} seeded
 * @param {Set<string>} covered
 * @returns {Array<{name: string, website?: string}>}
 */
export function tierTargets(seeded, covered) {
  const out = [];
  for (const [key, entry] of seeded) {
    if (!covered.has(key)) out.push(entry);
  }
  return out;
}

/**
 * Apply the Tier 3 scope rules to one raw row, BEFORE it reaches the shared
 * ingest. Returns a rejection reason, or null when the row is in scope.
 *
 * @param {any} row
 * @param {Map<string, unknown>} seeded
 * @param {Set<string>} covered
 * @returns {string|null}
 */
export function scopeViolation(row, seeded, covered) {
  const company = typeof row?.company === 'string' ? row.company.trim() : '';
  if (!company) return 'no company on the row — Tier 3 searches one company at a time, so this should never be blank';

  const key = companyKey(company);
  if (!seeded.has(key)) {
    return `"${company}" is not on the seed list — Tier 3 never touches an arbitrary domain (add it with \`npm run add-company\`)`;
  }
  if (covered.has(key)) {
    return `"${company}" already has an ATS tenant in portals.yml — Tier 2 reaches it, so Tier 3 must not add it again`;
  }

  const url = typeof row?.url === 'string' ? row.url.trim() : '';
  if (!url) return `no url for "${company}"`;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return `malformed url for "${company}": ${url}`;
  }
  if (isNonEmployerHost(host)) {
    return `${host} is an aggregator or ATS, not "${company}"'s own site — an ATS hit means Tier 2 missed a tenant; seed it rather than routing the posting through Tier 3`;
  }

  return null;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  let seeded;
  let covered;
  try {
    seeded = loadSeedCompanies();
    covered = loadCoveredCompanies();
  } catch (e) {
    console.error(`careers-scan: ${e.message}`);
    return 2;
  }

  if (args.includes('--list-targets')) {
    const targets = tierTargets(seeded, covered);
    console.log(JSON.stringify({
      seeded: seeded.size,
      alreadyCoveredByAts: covered.size,
      targets: targets.length,
      companies: targets,
    }, null, 2));
    return 0;
  }

  const dryRun = args.includes('--dry-run');
  const useStdin = args.includes('--stdin');
  const fileArg = args.find((a) => !a.startsWith('-'));
  if (!useStdin && !fileArg) {
    console.error('careers-scan: pass --stdin, a results.json path, or --list-targets. See --help.');
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(useStdin ? readFileSync(0, 'utf8') : readFileSync(fileArg, 'utf8'));
  } catch (e) {
    console.error(`careers-scan: could not read/parse input: ${e.message}`);
    return 2;
  }

  let matchesTitle;
  try {
    matchesTitle = loadTitleFilter();
  } catch (e) {
    console.error(`careers-scan: ${e.message}`);
    return 2;
  }

  // Scope gate runs first, so an out-of-scope row is reported as a SCOPE
  // rejection rather than disappearing into the title filter's count. The
  // difference matters: "5 filtered by title" and "5 refused because they were
  // LinkedIn URLs" call for completely different follow-up.
  const rows = Array.isArray(parsed) ? parsed
    : (parsed?.results || parsed?.data || parsed?.rows || parsed?.items || []);
  const inScope = [];
  const outOfScope = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const violation = scopeViolation(row, seeded, covered);
    if (violation) outOfScope.push(violation);
    else inScope.push(row);
  }

  const snapshot = loadDedupSnapshot();
  const { tagged, filteredTitle, dupes, invalid, byMarket } = ingest(
    inScope, matchesTitle, snapshot, { sourceTier: SOURCE_TIER },
  );

  if (!dryRun && tagged.length > 0) {
    await appendToPipeline(tagged);
    await appendToScanHistory(tagged, localToday(), 'added');
  }

  console.log(JSON.stringify({
    added: dryRun ? 0 : tagged.length,
    wouldAdd: tagged.length,
    dryRun,
    outOfScope: outOfScope.length,
    outOfScopeReasons: outOfScope.slice(0, 20),
    filteredTitle,
    dupes,
    invalid: invalid.length,
    invalidReasons: invalid.slice(0, 20),
    byMarket,
    unknownMarket: byMarket[UNKNOWN_MARKET] || 0,
    rows: tagged.map((o) => ({
      company: o.company, title: o.title, location: o.location, market: o.market, url: o.url,
    })),
  }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`careers-scan: ${e.message}`);
    process.exitCode = 1;
  });
}

export { main, SOURCE_TIER };
