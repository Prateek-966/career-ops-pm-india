#!/usr/bin/env node

/**
 * india-scan.mjs — turn Indeed MCP search results into deduped pipeline rows
 * (PRD v2 §B2, Tier 1).
 *
 * ── Why this is a script and not a provider ────────────────────────────────
 *
 * The Indeed connector is an MCP tool, not a public keyed API. There is no URL
 * a `providers/indeed.mjs` could fetch, and re-implementing the connector as a
 * scraper is the exact mistake this tier exists to avoid. So the integration
 * sits at the AGENT layer: the agent runs `modes/india-scan.md`, calls
 * `mcp__Indeed__search_jobs` across the location x query matrix, and pipes the
 * collected rows into this script.
 *
 * ── Where the real work lives ──────────────────────────────────────────────
 *
 * Almost nowhere in this file. Validation, the title filter, the three levels
 * of dedupe and the market/source tagging are in `scan-ingest.mjs`, shared with
 * the Tier 3 careers-page scanner — because a second copy of dedupe is the
 * thing that rots silently. And that module in turn defers to `scan.mjs`'s own
 * `loadDedupSnapshot` / `appendToPipeline` / `appendToScanHistory`, so an
 * Indeed-sourced row is deduped against the same history, under the same lock,
 * by the same rules as a Greenhouse-sourced one.
 *
 * What is left here is what is genuinely Indeed-specific: the tier label, the
 * `indeed_id` note tag, and the CLI.
 *
 * ── Untrusted input ────────────────────────────────────────────────────────
 *
 * Everything on stdin originated in a job posting. Per AGENTS.md it is data,
 * never instructions.
 *
 * Usage:
 *   node india-scan.mjs --stdin < results.json
 *   node india-scan.mjs results.json
 *   node india-scan.mjs --stdin --dry-run     # print what would be written
 *   node india-scan.mjs --help
 *
 * Input JSON: an array of rows, or { jobs|results|rows|items|data: [...] }.
 * Each row:
 *   {
 *     "title":    "Senior Product Manager",     // required
 *     "url":      "https://to.indeed.com/...",  // required, absolute http(s)
 *     "company":  "Acme",                       // required for role dedupe
 *     "location": "Pune, Maharashtra",          // optional
 *     "postedAt": "2026-08-21" | epoch ms,      // optional, never guessed
 *     "salary":   "...",                        // optional, VERBATIM
 *     "jobId":    "JOBSEARCH_220"               // optional, kept in note:
 *   }
 */

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

import { ingest, loadTitleFilter, localToday } from './scan-ingest.mjs';
import { UNKNOWN_MARKET } from './market-map.mjs';
import { loadDedupSnapshot, appendToPipeline, appendToScanHistory } from './scan.mjs';

/**
 * Records where the posting was DISCOVERED, not where it is hosted: a role
 * found on Indeed but read from the company's Greenhouse page is `indeed`.
 * `source_tier` in the report's Machine Summary must agree (modes/_custom.md).
 */
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

  let matchesTitle;
  try {
    matchesTitle = loadTitleFilter();
  } catch (e) {
    console.error(`india-scan: ${e.message}`);
    return 2;
  }

  const snapshot = loadDedupSnapshot();
  const { tagged, filteredTitle, dupes, invalid, byMarket } = ingest(
    parsed, matchesTitle, snapshot, { sourceTier: SOURCE_TIER, idLabel: 'indeed_id' },
  );

  if (tagged.length === 0 && invalid.length === 0 && filteredTitle === 0 && dupes === 0) {
    console.error('india-scan: no rows found — expected an array, or {jobs|results|rows|items|data: [...]}.');
    return 2;
  }

  if (!dryRun && tagged.length > 0) {
    await appendToPipeline(tagged);
    await appendToScanHistory(tagged, localToday(), 'added');
  }

  console.log(JSON.stringify({
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
  }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`india-scan: ${e.message}`);
    process.exitCode = 1;
  });
}

export { main, SOURCE_TIER };
