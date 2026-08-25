/**
 * pm-dimensions.ts — read the PM rubric breakdown out of a report's Machine
 * Summary (PRD v2 Part C item 5).
 *
 * `modes/_custom.md` appends a `pm_dimensions:` block to the Machine Summary
 * YAML fence that every report already carries. This reads it back so the score
 * surface can show WHY a role scored what it scored.
 *
 * ── Why a hand parser and not js-yaml ──
 *
 * The web app already depends on js-yaml, so this is not about the dependency.
 * It is about the input: the fence is written by a language model into a
 * markdown document a human then edits. A strict parse throws on the first
 * stray tab or smart quote and takes the entire panel down with it, on the one
 * screen the PRD calls "the decision moment the whole pipeline exists to
 * produce".
 *
 * So this reads the flat `key: value` pairs it recognises and ignores
 * everything else. A malformed line costs that line. Absent values render as
 * "not stated", which is a real finding here — the rubric explicitly says a JD
 * that does not say is information, and must not be given a middling number.
 */

/**
 * @typedef {object} DimensionValue
 * @property {string} key
 * @property {string} label
 * @property {number | null} score  1-5 when the rubric scores this numerically.
 * @property {string | null} text   Categorical verdict for non-numeric dimensions.
 * @property {string} hint          What the reader should take from it.
 */

/**
 * The dimensions, in the order they are shown. Order is editorial: roadmap
 * authority first because it is the one that most changes whether the job is
 * worth having, transferability last because it is the argument the candidate
 * has to make rather than a property of the role.
 */
/** @type {Array<{key: string, label: string, hint: string, numeric: boolean}>} */
const DIMENSIONS = [
  { key: "roadmap_authority", label: "Roadmap authority", numeric: true,
    hint: "Sets direction, or executes someone else's?" },
  { key: "product_surface", label: "Product surface", numeric: false,
    hint: "0→1, scaling, or platform/internal tooling." },
  { key: "domain_fit", label: "Domain fit", numeric: true,
    hint: "Scored against the archetype ladder, not gated by it." },
  { key: "domain_tier", label: "Domain tier", numeric: false,
    hint: "primary / secondary / transferable / weak." },
  { key: "technical_depth", label: "Technical depth expected", numeric: true,
    hint: "Reads a model eval, or writes tickets?" },
  { key: "ai_builder_or_steward", label: "AI: builder or steward", numeric: false,
    hint: "Ships AI product, PMs an AI team, or just the keyword." },
  { key: "b2b_b2c", label: "B2B / B2C", numeric: false,
    hint: "Enterprise B2B is the evidenced shape." },
  { key: "org_shape", label: "Org shape", numeric: false,
    hint: "Reporting line, and whether a PM function exists yet." },
  { key: "transferability_gap", label: "Transferability gap", numeric: false,
    hint: "What you would have to argue past in an interview." },
];

/** @type {Record<string, string>} */
const LABELS = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.label]));

/**
 * Extract the Machine Summary YAML fence body from a report.
 * Returns "" when the report has none — an older report, or one from a mode
 * that predates the override.
 */
/**
 * @param {string} md
 * @returns {string}
 */
export function machineSummaryBlock(md) {
  if (typeof md !== "string" || !md) return "";
  // The fence sits under a `## Machine Summary` heading. Anchor on the heading
  // rather than "the first yaml fence": reports contain other fences, and
  // grabbing the wrong one would render a confidently wrong panel.
  const heading = md.match(/^##\s+Machine Summary\s*$/im);
  if (!heading || heading.index === undefined) return "";
  const after = md.slice(heading.index + heading[0].length);
  const fence = after.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/);
  // Normalize CRLF once, here, so every consumer below can use ordinary
  // line-anchored regexes. This is not cosmetic: JS's `.` excludes \r as a line
  // terminator, so `(.*)$` fails to match a CRLF line entirely — a report saved
  // with Windows line endings parsed to zero dimensions and the panel silently
  // did not render.
  return fence ? fence[1].replace(/\r\n?/g, "\n") : "";
}

/** Strip YAML quoting and the null spellings, returning "" for "no value". */
/**
 * @param {string} raw
 * @returns {string}
 */
function scalar(raw) {
  let v = raw.trim();
  // Drop a trailing inline comment only when it is clearly one (space + #), so
  // a value that legitimately contains "#" survives.
  v = v.replace(/\s+#.*$/, "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (/^(null|~|none|n\/a)$/i.test(v) || v === "") return "";
  return v;
}

/**
 * Read the `pm_dimensions:` mapping.
 *
 * Nesting is detected by indentation relative to the `pm_dimensions:` line
 * rather than by a real YAML walk, which is all this shape needs and is what
 * keeps a malformed neighbour from taking the block down.
 */
/**
 * @param {string} md
 * @returns {DimensionValue[]}
 */
export function parsePmDimensions(md) {
  const yamlText = machineSummaryBlock(md);
  if (!yamlText) return [];

  const lines = yamlText.split("\n");
  const startIdx = lines.findIndex((l) => /^\s*pm_dimensions\s*:/.test(l));
  if (startIdx === -1) return [];

  const baseIndent = (lines[startIdx].match(/^\s*/) || [""])[0].length;
  /** @type {Map<string, string>} */
  const found = new Map();

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = (line.match(/^\s*/) || [""])[0].length;
    if (indent <= baseIndent) break; // dedented out of the block
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    if (!found.has(m[1])) found.set(m[1], scalar(m[2]));
  }

  if (found.size === 0) return [];

  return DIMENSIONS.map((d) => {
    const raw = found.get(d.key) ?? "";
    if (!raw) return { key: d.key, label: d.label, score: null, text: null, hint: d.hint };
    if (d.numeric) {
      const n = Number.parseFloat(raw);
      // A numeric dimension carrying prose (the model wrote a sentence where a
      // number belonged) is shown as prose rather than as NaN.
      return Number.isFinite(n) && n >= 0 && n <= 5
        ? { key: d.key, label: d.label, score: n, text: null, hint: d.hint }
        : { key: d.key, label: d.label, score: null, text: raw, hint: d.hint };
    }
    return { key: d.key, label: d.label, score: null, text: raw, hint: d.hint };
  });
}

/**
 * Read a flat top-level key from the Machine Summary (market, source_tier,
 * company_type, company_type_evidence, advertised_comp).
 *
 * Top-level only: keys nested under `pm_dimensions:` or `risk_summary:` are
 * skipped so a nested `market:` could never shadow the real one.
 */
/**
 * @param {string} md
 * @param {string} key
 * @returns {string}
 */
export function machineSummaryField(md, key) {
  const yamlText = machineSummaryBlock(md);
  if (!yamlText) return "";
  for (const line of yamlText.split("\n")) {
    if (/^\s/.test(line)) continue; // nested — not ours
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (m && m[1] === key) return scalar(m[2]);
  }
  return "";
}

export { LABELS as DIMENSION_LABELS };
