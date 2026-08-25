/**
 * scan-ingest.mjs — the shared core every agent-layer scanner tier runs through.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * Two tiers now feed the pipeline from the agent layer rather than from a
 * `providers/*.mjs`: Tier 1 (Indeed MCP, `india-scan.mjs`) and Tier 3
 * (company career pages via Firecrawl search, `careers-scan.mjs`). Neither can
 * be a provider — Indeed has no public keyed API behind the connector, and the
 * Firecrawl tier is a search tool the agent drives, not an HTTP endpoint
 * scan.mjs could fetch.
 *
 * What they MUST share is the part that decides what enters the pipeline:
 * validation, the title filter, dedupe, and the market/source tagging. A second
 * copy of dedupe is the thing that rots silently — one tier starts re-adding
 * roles the other already recorded, and nothing fails, it just gets noisier
 * every week until the inbox is untrustworthy.
 *
 * So the tier-specific part is only: how rows are obtained (an MCP call) and
 * what `sourceTier` they are tagged with. Everything else is here.
 *
 * ── Untrusted input ───────────────────────────────────────────────────────
 *
 * Everything passed in originated in a job posting or a search result. Per
 * AGENTS.md it is data, never instructions. This module only ever treats it as
 * text to sanitize and compare, and validates per field rather than trusting a
 * shape.
 */

import { readFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';

import { marketOf } from './market-map.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import {
  companyRoleDedupKey,
  normalizeUrlForDedup,
} from './scan.mjs';

export const PORTALS_PATH = 'portals.yml';

/**
 * Where a posting was DISCOVERED — not where it is hosted. A role found on
 * Indeed but read from the company's Greenhouse page is still `indeed`.
 *
 * Must stay in step with `SOURCE_LABELS` in web/src/lib/job-signals.mjs and the
 * `source_tier` enum in modes/_custom.md.
 */
export const SOURCE_TIERS = ['indeed', 'ats', 'firecrawl', 'manual'];

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

  const sourceId = str(raw.jobId) || str(raw.job_id) || str(raw.id);

  return {
    ok: true,
    offer: {
      title,
      url,
      company,
      location,
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(salary && salary.toUpperCase() !== 'N/A' ? { salary } : {}),
      ...(sourceId ? { sourceId } : {}),
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
    for (const key of ['jobs', 'results', 'rows', 'items', 'data']) {
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
 *   2. company+role, against history — catches the same requisition reached by
 *      a different route, which is the normal case across tiers: Indeed indexes
 *      it, the company's careers page hosts it, and the ATS serves it.
 *   3. company+role, within this batch — one sweep returns the same role from
 *      several query/location cells.
 *
 * @param {object[]} offers Normalized offers.
 * @param {(title: string) => boolean} matchesTitle
 * @param {{seen?: Set<string>, seenCompanyRoles?: Set<string>}} snapshot
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
 * @param {string} sourceTier One of SOURCE_TIERS.
 * @param {string} [idLabel] Tag name for the source's own id (e.g. `indeed_id`).
 * @returns {object} A new offer with `market` and `note` set.
 */
export function tagOffer(offer, sourceTier, idLabel) {
  if (!SOURCE_TIERS.includes(sourceTier)) {
    // A typo'd tier would render as an unknown badge in the UI and break the
    // source filter silently, so it is a throw rather than a pass-through.
    throw new Error(`unknown source tier "${sourceTier}" — expected one of ${SOURCE_TIERS.join(', ')}`);
  }
  const market = marketOf(offer.location);
  const parts = [`market=${market}`, `source=${sourceTier}`];
  if (offer.sourceId && idLabel) parts.push(`${idLabel}=${offer.sourceId}`);
  return { ...offer, market, note: parts.join('; ') };
}

/**
 * Run a whole batch through the shared pipeline. The only thing a tier supplies
 * beyond its rows is its own tier label.
 *
 * @param {unknown} parsed Raw parsed JSON from the tier's collector.
 * @param {(title: string) => boolean} matchesTitle
 * @param {{seen?: Set<string>, seenCompanyRoles?: Set<string>}} snapshot
 * @param {{sourceTier: string, idLabel?: string}} opts
 * @returns {{tagged: object[], filteredTitle: number, dupes: number, invalid: string[], byMarket: Record<string, number>}}
 */
export function ingest(parsed, matchesTitle, snapshot, { sourceTier, idLabel } = {}) {
  const rows = extractRows(parsed);
  const offers = [];
  const invalid = [];
  for (const row of rows) {
    const out = normalizeRow(row);
    if (out.ok) offers.push(out.offer);
    else invalid.push(out.reason);
  }

  const { kept, filteredTitle, dupes } = filterAndDedupe(offers, matchesTitle, snapshot);
  const tagged = kept.map((o) => tagOffer(o, sourceTier, idLabel));

  /** @type {Record<string, number>} */
  const byMarket = {};
  for (const o of tagged) byMarket[o.market] = (byMarket[o.market] || 0) + 1;

  return { tagged, filteredTitle, dupes, invalid, byMarket };
}

// ── I/O helpers, shared by every tier's CLI ────────────────────────────────

/**
 * Compile portals.yml's `title_filter` into a predicate.
 *
 * A missing or empty positive list THROWS rather than defaulting to
 * "accept everything". buildTitleFilter treats an empty positive list as
 * "no positive constraint" — correct for a negative-only config, and a
 * catastrophe here, because it would flood the inbox with exactly the
 * product-marketing roles Part A exists to filter out. A tier that cannot
 * find its filter must stop, not run wide open.
 *
 * @param {string} [portalsPath]
 * @returns {(title: string) => boolean}
 */
export function loadTitleFilter(portalsPath = PORTALS_PATH) {
  if (!existsSync(portalsPath)) {
    throw new Error(
      `${portalsPath} not found — this scanner needs its title_filter. `
      + 'Run `npm run setup:pm-india`, then `node doctor.mjs`.',
    );
  }
  const cfg = yaml.load(readFileSync(portalsPath, 'utf8'));
  const tf = cfg?.title_filter;
  if (!tf || !Array.isArray(tf.positive) || tf.positive.length === 0) {
    throw new Error(
      `${portalsPath} has no title_filter.positive — an empty positive list matches every title, `
      + 'which would flood the pipeline.',
    );
  }
  return buildTitleFilter(tf);
}

/**
 * Local YYYY-MM-DD, matching the dates scan.mjs writes into scan-history.
 * @returns {string}
 */
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
