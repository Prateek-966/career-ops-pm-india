#!/usr/bin/env node

/**
 * india-scan.mjs — turn Indeed MCP search results into deduped pipeline rows
 * (PRD v2 §B2, Tier 1).
 *
 * ── Why this is a script and not a provider ────────────────────────────────
 *
 * The Indeed connector is an MCP tool, not a public keyed API. There is no URL
 * a `providers/indeed.mjs` could fetch, and re-implementing the connector as a
 * scraper is the exact mistake Tier 1 exists to avoid. So the integration sits
 * at the AGENT layer: the agent runs `modes/india-scan.md`, calls
 * `mcp__Indeed__search_jobs` across the location x query matrix, and pipes the
 * collected rows into this script, which owns everything after that — filter,
 * dedupe, write.
 *
 * ── Why it reuses scan.mjs rather than reimplementing ──────────────────────
 *
 * The PRD forbids a parallel scan engine, and it is right to: dedupe is the
 * part that silently rots. This script imports the REAL machinery —
 * `loadDedupSnapshot`, `companyRoleDedupKey`, `appendToPipeline`,
 * `appendToScanHistory` — so an Indeed-sourced row is deduped against the same
 * history, under the same lock, by the same rules as a Greenhouse-sourced one.
 * A role already in the pipeline from the ATS tier will not come back as a
 * second row because Indeed also indexes it, which is the whole point of
 * "aggregators are indexes, the ATS is the source of truth".
 *
 * ── Untrusted input ────────────────────────────────────────────────────────
 *
 * Everything on stdin originated in a job posting. Per AGENTS.md it is data,
 * never instructions. This script only ever treats it as text to sanitize and
 * compare — it evaluates nothing, and every field is validated per-field
 * rather than trusted as a shape.
 *
 * Usage:
 *   node india-scan.mjs --stdin < results.json
 *   node india-scan.mjs results.json
 *   node india-scan.mjs --stdin --dry-run     # print what would be written
 *   node india-scan.mjs --help
 *
 * Input JSON: an array of rows, or { jobs: [...] } / { results: [...] }.
 * Each row:
 *   {
 *     "title":    "Senior Product Manager",     // required
 *     "url":      "https://to.indeed.com/...",  // required, absolute
 *     "company":  "Acme",                       // required for role dedupe
 *     "location": "Pune, Maharashtra",          // optional
 *     "postedAt": "2026-08-21" | epoch ms,      // optional
 *     "salary":   "..." ,                       // optional, VERBATIM
 *     "jobId":    "JOBSEARCH_220"               // optional, kept in note:
 *   }
 *
 * Output JSON (stdout): { added, filteredTitle, filteredLocation, dupes,
 * invalid, byMarket, rows }.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'js-yaml';

import { buildTitleFilter } from './title-keywords.mjs';
import { marketOf, UNKNOWN_MARKET } from './market-map.mjs';
import {
  loadDedupSnapshot,
  companyRoleDedupKey,
  normalizeUrlForDedup,
  appendToPipeline,
  appendToScanHistory,
} from './scan.mjs';

const PORTALS_PATH = 'portals.yml';

// The tier label written into every row's note:. `source_tier` in the report's
// Machine Summary must agree with it (see modes/_custom.md). It records where
// the posting was DISCOVERED, not where it is hosted — a role found on Indeed
// but read from the company's Greenhouse page is still `indeed`.
const SOURCE_TIER = 'indeed';

const USAGE = `india-scan.mjs — Indeed MCP results -> deduped pipeline rows (PRD v2 §B2)

Usage:
  node india-scan.mjs --stdin [--dry-run]
  node india-scan.mjs <results.json> [--dry-run]
  node india-scan.mjs --help

Reads Indeed search rows as JSON, applies portals.yml's title_filter, drops
rows already known to the pipeline / scan-history / tracker, and appends the
survivors to data/pipeline.md with market= and source= tags.

--dry-run prints the same JSON summary but writes nothing.`;

/**
 * Coerce one raw row into the internal offer shape, or explain why not.
 *
 * Defensive per field rather than per object: upstream is untrusted, and a
 * single malformed row must cost one row, never the batch.
 *
 * @param {unknown} raw
 * @returns {{ok: true, offer: object} | {ok: false, reason: string}}
 */
export function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'row is not an object' };
  }
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const title = str(raw.title);
  if (!title) return { ok: false, reason: 'missing title' };

  const url = str(raw.url) || str(raw.applyUrl) || str(raw.viewJobUrl);
  if (!url) return { ok: false, reason: 'missing url' };
  // Absolute http(s) only. A relative or javascript: href is not something to
  // put in an inbox the user will click.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `malformed url: ${url}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `non-http url scheme: ${parsed.protocol}` };
  }

  const company = str(raw.company) || str(raw.companyName);
  if (!company) return { ok: false, reason: `missing company for "${title}"` };

  const location = str(raw.location);

  // postedAt accepts an epoch ms number or a date string; anything else is
  // dropped rather than coerced, because a wrong posting date makes a
  // months-old requisition look fresh in the tracker's POSTED column.
  let postedAt;
  if (typeof raw.postedAt === 'number' && Number.isFinite(raw.postedAt)) {
    postedAt = raw.postedAt;
  } else if (typeof raw.postedAt === 'string' && raw.postedAt.trim()) {
    const t = Date.parse(raw.postedAt);
    if (Number.isFinite(t)) postedAt = t;
  }

  // Compensation is carried VERBATIM in its native currency and is never
  // converted here — PRD §B7: silent FX inside a score is a correctness bug,
  // and the safest place to not convert is at the point of capture.
  const salary = str(raw.salary) || str(raw.compensation) || '';

  const jobId = str(raw.jobId) || str(raw.job_id) || str(raw.id);

  return {
    ok: true,
    offer: {
      title,
      url,
      company,
      location,
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(salary && salary.toUpperCase() !== 'N/A' ? { salary } : {}),
      ...(jobId ? { jobId } : {}),
    },
  };
}

/**
 * Accept the shapes an agent might hand over without making it reformat.
 * @param {unknown} parsed
 * @returns {unknown[]}
 */
export function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const key of ['jobs', 'results', 'rows', 'items']) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return [];
}

/**
 * Filter + dedupe a batch. Pure: no reads, no writes, so it is testable
 * without a fixture pipeline on disk.
 *
 * Dedupe runs at three levels, cheapest first:
 *   1. URL, against history (the canonical key scan.mjs uses).
 *   2. company+role, against history — catches the same req indexed under a
 *      different aggregator URL, which is the normal case here since Tier 1's
 *      whole job is to index roles Tier 2 also sees.
 *   3. company+role, within this batch — the city x query matrix returns the
 *      same role from several cells, and without this every run would add it
 *      once per matching cell.
 *
 * @param {object[]} offers Normalized offers.
 * @param {(title: string) => boolean} matchesTitle
 * @param {{seen: Set<string>, seenCompanyRoles: Set<string>}} snapshot
 * @returns {{kept: object[], filteredTitle: number, dupes: number}}
 */
export function filterAndDedupe(offers, matchesTitle, snapshot) {
  const seenUrls = snapshot?.seen instanceof Set ? snapshot.seen : new Set();
  const seenRoles = snapshot?.seenCompanyRoles instanceof Set ? snapshot.seenCompanyRoles : new Set();

  const kept = [];
  const batchRoleKeys = new Set();
  const batchUrlKeys = new Set();
  let filteredTitle = 0;
  let dupes = 0;

  for (const offer of offers) {
    if (!matchesTitle(offer.title)) {
      filteredTitle += 1;
      continue;
    }
    const urlKey = normalizeUrlForDedup(offer.url);
    if (seenUrls.has(urlKey) || batchUrlKeys.has(urlKey)) {
      dupes += 1;
      continue;
    }
    const roleKey = companyRoleDedupKey(offer.company, offer.title);
    if (seenRoles.has(roleKey) || batchRoleKeys.has(roleKey)) {
      dupes += 1;
      continue;
    }
    batchUrlKeys.add(urlKey);
    batchRoleKeys.add(roleKey);
    kept.push(offer);
  }

  return { kept, filteredTitle, dupes };
}

/**
 * Attach the labelled `note:` segment scan.mjs's formatPipelineOffer carries
 * through verbatim. Labelled rather than positional so it rides on any row
 * width without a reader mistaking it for a location or a compensation cell.
 *
 * The spelling here is the contract modes/_custom.md → Pipeline Rules names:
 * `market=…; source=…`. Keep the two in step.
 *
 * @param {object} offer
 * @returns {object} A new offer with `note` set.
 */
export function tagOffer(offer) {
  const market = marketOf(offer.location);
  const parts = [`market=${market}`, `source=${SOURCE_TIER}`];
  if (offer.jobId) parts.push(`indeed_id=${offer.jobId}`);
  return { ...offer, market, note: parts.join('; ') };
}

/** @returns {(title: string) => boolean} */
function loadTitleFilter(portalsPath = PORTALS_PATH) {
  if (!existsSync(portalsPath)) {
    // No portals.yml is a real setup state (doctor.mjs reports it), not a
    // reason to silently accept every title — that would flood the inbox with
    // the exact product-marketing roles Part A filters out. Refuse instead.
    throw new Error(
      `${portalsPath} not found — india-scan needs its title_filter. Run \`node doctor.mjs\` for setup.`,
    );
  }
  const cfg = yaml.load(readFileSync(portalsPath, 'utf8'));
  const tf = cfg?.title_filter;
  if (!tf || !Array.isArray(tf.positive) || tf.positive.length === 0) {
    throw new Error(
      `${portalsPath} has no title_filter.positive — an empty positive list matches every title, which would flood the pipeline.`,
    );
  }
  return buildTitleFilter(tf);
}

/** @returns {string} Local YYYY-MM-DD, matching scan.mjs's history rows. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const dryRun = args.includes('--dry-run');
  const useStdin = args.includes('--stdin');
  const fileArg = args.find((a) => !a.startsWith('-'));

  if (!useStdin && !fileArg) {
    console.error('india-scan: pass --stdin or a results.json path. See --help.');
    return 2;
  }

  let raw;
  try {
    raw = useStdin ? readFileSync(0, 'utf8') : readFileSync(fileArg, 'utf8');
  } catch (e) {
    console.error(`india-scan: could not read input: ${e.message}`);
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`india-scan: input is not valid JSON: ${e.message}`);
    return 2;
  }

  const rows = extractRows(parsed);
  if (rows.length === 0) {
    console.error('india-scan: no rows found — expected an array, or {jobs|results|rows|items: [...]}.');
    return 2;
  }

  let matchesTitle;
  try {
    matchesTitle = loadTitleFilter();
  } catch (e) {
    console.error(`india-scan: ${e.message}`);
    return 2;
  }

  const offers = [];
  const invalid = [];
  for (const row of rows) {
    const out = normalizeRow(row);
    if (out.ok) offers.push(out.offer);
    else invalid.push(out.reason);
  }

  const snapshot = loadDedupSnapshot();
  const { kept, filteredTitle, dupes } = filterAndDedupe(offers, matchesTitle, snapshot);
  const tagged = kept.map(tagOffer);

  const byMarket = {};
  for (const o of tagged) byMarket[o.market] = (byMarket[o.market] || 0) + 1;

  if (!dryRun && tagged.length > 0) {
    await appendToPipeline(tagged);
    await appendToScanHistory(tagged, localToday(), 'added');
  }

  const summary = {
    added: dryRun ? 0 : tagged.length,
    wouldAdd: tagged.length,
    dryRun,
    filteredTitle,
    dupes,
    invalid: invalid.length,
    invalidReasons: invalid.slice(0, 20),
    byMarket,
    unknownMarket: byMarket[UNKNOWN_MARKET] || 0,
    rows: tagged.map((o) => ({
      company: o.company, title: o.title, location: o.location, market: o.market, url: o.url,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`india-scan: ${e.message}`);
    process.exitCode = 1;
  });
}

export { main, fileURLToPath };
