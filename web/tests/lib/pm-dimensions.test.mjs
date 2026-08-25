// Tests for reading the PM rubric breakdown out of a report's Machine Summary
// (PRD v2 Part C item 5 — the score surface).
//
// This parser feeds the one screen the PRD calls "the decision moment the whole
// pipeline exists to produce", and its input is a YAML fence written by a
// language model into a markdown file a human then edits. So the contract under
// test is mostly about DEGRADING WELL:
//
//   - A malformed line costs that line, never the panel.
//   - `null` means "the JD does not say" and must survive as null. Substituting
//     a middling number would put a fabricated data point on the one screen
//     that must not have any.
//   - A nested key must never be read as a top-level one, or `risk_summary`'s
//     values leak into the header fields.
//
// Run:  node --test tests/lib/pm-dimensions.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  machineSummaryBlock,
  machineSummaryField,
  parsePmDimensions,
} from "../../src/lib/pm-dimensions.mjs";

const REPORT = `# Evaluation: Acme — Senior Product Manager

**Score:** 4.2/5
**Legitimacy:** High Confidence

---

## Machine Summary

\`\`\`yaml
company: "Acme"
role: "Senior Product Manager"
score: 4.2
market: "india"
source_tier: "indeed"
company_type: "gcc"
company_type_evidence: "JD says 'partner with HQ product teams'"
pm_dimensions:
  roadmap_authority: 3
  product_surface: "platform"
  domain_fit: 4
  domain_tier: "primary"
  technical_depth: null
  ai_builder_or_steward: "not_applicable"
  b2b_b2c: "b2b"
  org_shape: "Reports to Director, Platform; PM function exists"
  transferability_gap: "No telco billing exposure"
risk_summary:
  legitimacy: "high_confidence"
  culture: "pass"
\`\`\`

## A) Role Summary

Prose here.
`;

test("finds the Machine Summary fence", () => {
  const block = machineSummaryBlock(REPORT);
  assert.match(block, /company: "Acme"/);
  assert.match(block, /pm_dimensions:/);
});

test("reads top-level machine-summary fields", () => {
  assert.equal(machineSummaryField(REPORT, "company_type"), "gcc");
  assert.equal(machineSummaryField(REPORT, "market"), "india");
  assert.equal(machineSummaryField(REPORT, "source_tier"), "indeed");
  assert.equal(machineSummaryField(REPORT, "company_type_evidence"), "JD says 'partner with HQ product teams'");
});

test("a NESTED key is never read as a top-level one", () => {
  // `legitimacy` lives under risk_summary. Reading it as top-level would put
  // risk values into the header fields.
  assert.equal(machineSummaryField(REPORT, "legitimacy"), "");
  assert.equal(machineSummaryField(REPORT, "culture"), "");
  // …and a dimension key is likewise not a top-level field.
  assert.equal(machineSummaryField(REPORT, "domain_fit"), "");
});

test("parses numeric and categorical dimensions in one pass", () => {
  const dims = parsePmDimensions(REPORT);
  const by = Object.fromEntries(dims.map((d) => [d.key, d]));

  assert.equal(by.roadmap_authority.score, 3);
  assert.equal(by.roadmap_authority.text, null);

  assert.equal(by.domain_fit.score, 4);
  assert.equal(by.product_surface.text, "platform");
  assert.equal(by.product_surface.score, null);
  assert.equal(by.org_shape.text, "Reports to Director, Platform; PM function exists");
});

test("null means 'the JD does not say' and stays null", () => {
  const by = Object.fromEntries(parsePmDimensions(REPORT).map((d) => [d.key, d]));
  assert.equal(by.technical_depth.score, null);
  assert.equal(by.technical_depth.text, null);
});

test("every declared dimension is returned, present or not", () => {
  // The panel renders "Not stated" rows deliberately, so an absent key must
  // still produce a row rather than vanishing from the breakdown.
  const sparse = "## Machine Summary\n\n```yaml\npm_dimensions:\n  domain_fit: 5\n```\n";
  const dims = parsePmDimensions(sparse);
  assert.ok(dims.length > 1, "expected the full dimension list");
  assert.equal(dims.find((d) => d.key === "domain_fit").score, 5);
  const untouched = dims.find((d) => d.key === "roadmap_authority");
  assert.equal(untouched.score, null);
  assert.equal(untouched.text, null);
});

test("the null spellings a model actually writes are all handled", () => {
  for (const spelling of ["null", "~", "none", "N/A", '""', "''", ""]) {
    const md = `## Machine Summary\n\n\`\`\`yaml\npm_dimensions:\n  domain_fit: ${spelling}\n\`\`\`\n`;
    const d = parsePmDimensions(md).find((x) => x.key === "domain_fit");
    assert.equal(d.score, null, `spelling: ${spelling}`);
    assert.equal(d.text, null, `spelling: ${spelling}`);
  }
});

test("a numeric dimension carrying prose degrades to prose, not NaN", () => {
  const md = '## Machine Summary\n\n```yaml\npm_dimensions:\n  domain_fit: "hard to say"\n```\n';
  const d = parsePmDimensions(md).find((x) => x.key === "domain_fit");
  assert.equal(d.score, null);
  assert.equal(d.text, "hard to say");
});

test("an out-of-range number is treated as prose rather than rendered as a bar", () => {
  const md = "## Machine Summary\n\n```yaml\npm_dimensions:\n  domain_fit: 9\n```\n";
  const d = parsePmDimensions(md).find((x) => x.key === "domain_fit");
  assert.equal(d.score, null, "9 is not on a 1-5 scale");
  assert.equal(d.text, "9");
});

test("the block ends at the first dedent, not at the end of the fence", () => {
  const by = Object.fromEntries(parsePmDimensions(REPORT).map((d) => [d.key, d]));
  // `legitimacy` and `culture` sit under risk_summary AFTER pm_dimensions. If
  // the walk did not stop at the dedent it would keep consuming them.
  assert.ok(!("legitimacy" in by));
  assert.equal(by.transferability_gap.text, "No telco billing exposure");
});

test("returns empty for reports with no fence, no block, or garbage", () => {
  assert.deepEqual(parsePmDimensions("# Just a report\n\nNo machine summary here."), []);
  assert.deepEqual(parsePmDimensions("## Machine Summary\n\n```yaml\ncompany: \"X\"\n```\n"), []);
  assert.deepEqual(parsePmDimensions(""), []);
  assert.deepEqual(parsePmDimensions(null), []);
  assert.deepEqual(parsePmDimensions(undefined), []);
});

test("anchors on the Machine Summary heading, not the first yaml fence", () => {
  // Reports contain other fences. Grabbing the wrong one renders a
  // confidently wrong panel.
  const md = [
    "## E) Customization Plan",
    "",
    "```yaml",
    "pm_dimensions:",
    "  domain_fit: 1",
    "```",
    "",
    "## Machine Summary",
    "",
    "```yaml",
    "pm_dimensions:",
    "  domain_fit: 5",
    "```",
  ].join("\n");
  const d = parsePmDimensions(md).find((x) => x.key === "domain_fit");
  assert.equal(d.score, 5, "read the decoy fence instead of the Machine Summary");
});

test("survives a malformed neighbouring line", () => {
  const md = [
    "## Machine Summary",
    "",
    "```yaml",
    "pm_dimensions:",
    "  roadmap_authority: 4",
    "  this line is not yaml at all",
    "  domain_fit: 3",
    "```",
  ].join("\n");
  const by = Object.fromEntries(parsePmDimensions(md).map((d) => [d.key, d]));
  assert.equal(by.roadmap_authority.score, 4);
  assert.equal(by.domain_fit.score, 3, "one bad line took the rest of the block down");
});

test("handles an unlabelled fence and CRLF line endings", () => {
  const md = "## Machine Summary\r\n\r\n```\r\npm_dimensions:\r\n  domain_fit: 4\r\n```\r\n";
  const d = parsePmDimensions(md).find((x) => x.key === "domain_fit");
  assert.equal(d.score, 4);
});
