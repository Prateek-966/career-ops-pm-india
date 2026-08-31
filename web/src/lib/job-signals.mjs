/**
 * job-signals.ts — read the India/PM signals off a tracker row (PRD v2 Part C).
 *
 * The three labels Part C puts on a card — market, source tier, and
 * GCC/product/unclear — are written by the CLI as tagged segments in the
 * tracker row's Notes, using the same `key=value; ` convention the tracker
 * already uses for `via=` and `posted:`:
 *
 *     market=india; source=indeed; org=gcc
 *
 * That spelling is declared in `modes/_custom.md` → Pipeline Rules and written
 * by `india-scan.mjs` → `tagOffer`. All three must move together.
 *
 * Reading tags out of Notes rather than adding tracker COLUMNS is deliberate.
 * The tracker is a hand-editable markdown table that the CLI, the web app and
 * the user all write; every added column is a migration for existing files and
 * a new way for `tracker-sync-check` to find drift. A labelled note segment
 * rides on any row shape and is ignored by every reader that does not know it.
 *
 * Nothing here throws. Notes are free text a human edits — a malformed tag
 * degrades to "unknown", which is a visible bucket, never a dropped row.
 */

import { marketOf, UNKNOWN_MARKET, marketLabel } from "./market-map.mjs";

/**
 * Where a posting was DISCOVERED — not where it is hosted.
 * @typedef {"indeed" | "ats" | "firecrawl" | "manual"} SourceTier
 */

/**
 * The India-market distinction PRD §A1.3 calls the highest-signal one.
 * `unclear` is a first-class value, not a failure: guessing it silently is
 * the thing the rubric forbids.
 * @typedef {"gcc" | "product" | "unclear"} CompanyType
 */

/**
 * @typedef {object} JobSignals
 * @property {string} market
 * @property {string} marketLabel
 * @property {SourceTier | null} source
 * @property {CompanyType | null} companyType
 * @property {number | null} triageScore
 * @property {TriageBand | null} triageBand
 * @property {TriageConfidence | null} triageConfidence
 */

/**
 * @typedef {"review_first" | "worth_a_look" | "low" | "skip"} TriageBand
 * @typedef {"title-only" | "full-jd" | "rejected"} TriageConfidence
 */

/** @type {Set<string>} */
const SOURCE_VALUES = new Set(["indeed", "ats", "firecrawl", "manual"]);
/** @type {Set<string>} */
const COMPANY_TYPE_VALUES = new Set(["gcc", "product", "unclear"]);
/** @type {Set<string>} */
const TRIAGE_BANDS = new Set(["review_first", "worth_a_look", "low", "skip"]);
/** @type {Set<string>} */
const TRIAGE_CONFIDENCE = new Set(["title-only", "full-jd", "rejected"]);

/**
 * Pull `key=value` pairs out of a free-text Notes cell.
 *
 * Segments are separated by `;` or `|` because both appear in the wild: the
 * tracker's own Notes convention uses `; `, while a row carried over from a
 * pipeline line can arrive with `|`. Keys are lowercased; values keep their
 * case for display but are compared lowercased.
 */
/**
 * @param {string | undefined | null} notes
 * @returns {Record<string, string>}
 */
export function parseNoteTags(notes) {
  /** @type {Record<string, string>} */
  const out = {};
  if (typeof notes !== "string" || !notes) return out;
  for (const segment of notes.split(/[;|]/)) {
    const eq = segment.indexOf("=");
    if (eq < 1) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const value = segment.slice(eq + 1).trim();
    if (!key || !value) continue;
    // First tag wins: a hand-edit that appends a correction should not silently
    // override the scanner's record without the user seeing both.
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Resolve the three Part C labels for one tracker row.
 *
 * `market` prefers an explicit `market=` tag and falls back to normalizing the
 * row's location text. The fallback matters: rows added before the tag existed,
 * or pasted in by hand, still get bucketed rather than all landing in Unknown.
 *
 * `source` and `companyType` have NO fallback and return null when untagged.
 * There is no honest way to infer either from a tracker row — guessing "ats"
 * for anything untagged would make the provenance badge a lie, and guessing
 * `product` for an unlabelled company is exactly the silent guess §A1.3
 * forbids. Absent is shown as absent.
 */
/**
 * @param {{notes?: string, location?: string}} row
 * @returns {JobSignals}
 */
export function jobSignals(row) {
  const tags = parseNoteTags(row?.notes);

  const taggedMarket = (tags.market || "").toLowerCase();
  const market = taggedMarket || marketOf(row?.location ?? "");

  const taggedSource = (tags.source || tags.source_tier || "").toLowerCase();
  const source = SOURCE_VALUES.has(taggedSource) ? /** @type {SourceTier} */ (taggedSource) : null;

  const taggedOrg = (tags.org || tags.company_type || "").toLowerCase();
  const companyType = COMPANY_TYPE_VALUES.has(taggedOrg)
    ? /** @type {CompanyType} */ (taggedOrg)
    : null;

  // Triage score, written by scan-ingest's tagOffer. Absent is null, never 0 —
  // an unscored row must not sort as "worst", and a 0 would read as a verdict
  // rather than a missing measurement.
  const rawScore = Number(tags.score);
  const triageScore = Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100 ? rawScore : null;

  const taggedBand = (tags.band || "").toLowerCase();
  const triageBand = TRIAGE_BANDS.has(taggedBand) ? /** @type {TriageBand} */ (taggedBand) : null;

  const taggedConf = (tags.conf || tags.confidence || "").toLowerCase();
  const triageConfidence = TRIAGE_CONFIDENCE.has(taggedConf)
    ? /** @type {TriageConfidence} */ (taggedConf)
    : null;

  return { market, marketLabel: marketLabel(market), source, companyType, triageScore, triageBand, triageConfidence };
}

/** Display labels. Neutral wording — a source is a fact, not a grade. */
/** @type {Record<SourceTier, string>} */
export const SOURCE_LABELS = {
  indeed: "Indeed",
  ats: "ATS",
  firecrawl: "Firecrawl",
  manual: "Manual",
};

/**
 * Triage band labels. These name the NEXT ACTION, never the quality of the
 * role — "Excellent match" would invite a coarse ranking number to be read as
 * a fit verdict, which is the specific mistake prescore.mjs is documented to
 * avoid. The evaluation decides whether to apply; this only decides what to
 * open first.
 */
/** @type {Record<TriageBand, string>} */
export const TRIAGE_BAND_LABELS = {
  review_first: "Review first",
  worth_a_look: "Worth a look",
  low: "Low",
  skip: "Probably skip",
};

/**
 * How a triage score was arrived at. Shown next to the number because a
 * title-only 100 and a full-JD 100 are not the same claim.
 */
/** @type {Record<TriageConfidence, string>} */
export const TRIAGE_CONFIDENCE_LABELS = {
  "title-only": "from title only",
  "full-jd": "from full JD",
  rejected: "filtered out",
};

/** @type {Record<CompanyType, string>} */
export const COMPANY_TYPE_LABELS = {
  gcc: "GCC",
  product: "Product",
  unclear: "Unclear",
};

export { UNKNOWN_MARKET, marketLabel };

/**
 * Count rows per market, for the filter's tab counts.
 *
 * Returns the counts only — the caller decides which buckets to render, so an
 * empty Unknown bucket can still be shown deliberately (Part C requires the
 * bucket to be visible, and hiding it when empty is how "surfaced, never
 * dropped" quietly stops being true).
 */
/**
 * @param {Array<{notes?: string, location?: string}>} rows
 * @returns {Record<string, number>}
 */
export function countByMarket(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of rows) {
    const { market } = jobSignals(r);
    counts[market] = (counts[market] || 0) + 1;
  }
  return counts;
}
