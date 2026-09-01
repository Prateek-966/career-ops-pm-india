// web/tests/lib/triage-render.test.mjs
//
// The triage rank is the cheapest number in the app and sits next to the most
// expensive one. These assertions are about keeping them distinguishable — a
// coarse sort key read as a considered verdict is the specific failure
// prescore.mjs is written to avoid, and rendering is where that failure would
// actually happen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TRIAGE_BAND_LABELS,
  TRIAGE_CONFIDENCE_LABELS,
  jobSignals,
} from "../../src/lib/job-signals.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const component = readFileSync(join(here, "../../src/components/triage-score.tsx"), "utf8");

test("every band has a label, and none reads as a fit verdict", () => {
  const labels = Object.values(TRIAGE_BAND_LABELS);
  assert.equal(labels.length, 4);
  for (const l of labels) {
    // "Excellent match" / "Great fit" would invite a regex-derived number to be
    // read as a judgement about the role. These name the next action instead.
    assert.doesNotMatch(l, /match|fit|excellent|great|perfect|poor/i, `band label "${l}" reads as a verdict`);
  }
});

test("every confidence tier has a label that names its basis", () => {
  assert.match(TRIAGE_CONFIDENCE_LABELS["title-only"], /title/i);
  assert.match(TRIAGE_CONFIDENCE_LABELS["full-jd"], /JD/i);
});

test("the component does not use the good/warn/bad register", () => {
  // That register belongs to the evaluated fit score (score-breakdown.tsx uses
  // Badge tone={good|warn|bad}). Sharing it would make the cheap number look
  // like the considered one.
  assert.doesNotMatch(component, /tone=\{?["']?(good|warn|bad)/, "triage must not reuse the fit-score tones");
  assert.doesNotMatch(component, /emerald|red-500|amber-500/, "triage must not use traffic-light colours");
});

test("the component does not use brand orange", () => {
  // badge.tsx: "orange is reserved for active/selected, never for a score".
  // Matched as Tailwind CLASSES, not as prose — the component's own comment
  // explains why brand is avoided, and a bare /brand/ flagged that explanation
  // as the violation it was documenting.
  assert.doesNotMatch(
    component,
    /\b(?:text|bg|stroke|fill|border|ring|from|to|via)-brand\b/,
    "brand orange is reserved for active/selected",
  );
});

test("magnitude is carried by arc length, not by hue", () => {
  // strokeDasharray driven by the score is the magnitude encoding. A single
  // fixed hue means colour carries no information and therefore cannot
  // miscommunicate — and is colourblind-safe by construction.
  assert.match(component, /strokeDasharray=\{`\$\{score\}/, "the ring arc must be driven by the score");
  const hueMatches = component.match(/stroke-sky-\d+|bg-sky-\d+/g) || [];
  const distinct = new Set(hueMatches.map((h) => h.replace(/^(stroke|bg)-/, "")));
  // sky-500 (light) + sky-400 (dark) are one hue in two themes, not a ramp.
  assert.ok(distinct.size <= 2, `expected one hue across themes, found ${[...distinct].join(", ")}`);
});

test("an absent score renders nothing — never a zero", () => {
  // An unmeasured row is not a bad row. A 0 ring would say otherwise at a
  // glance, and would sort below a genuinely poor role.
  const guards = component.match(/if \(score === null\) return null;/g) || [];
  assert.equal(guards.length, 2, "both TriageRing and TriageBadge must bail on a null score");
});

test("confidence is always in the accessible label", () => {
  // A title-only 100 and a full-JD 100 are different claims. The compact
  // variant has no room to show the tier, so it must be in the label.
  const labelBuilds = component.match(/A sort order, not a fit score\./g) || [];
  assert.equal(labelBuilds.length, 2, "both variants must state that this is a sort order");
  assert.match(component, /confLabel/, "confidence must feed the label");
});

test("the number is rendered as text, not colour-alone", () => {
  assert.match(component, /tabular-nums/, "a column of scores must align");
  assert.match(component, /\{score\}</, "the score must appear as text");
});

test("the ring is labelled for screen readers", () => {
  assert.match(component, /role="img"/);
  assert.match(component, /aria-label=\{label\}/);
});

test("round-trip: what ingest writes is what the UI renders", () => {
  const sig = jobSignals({ notes: "market=india; source=ats; score=68; band=worth_a_look; conf=title-only" });
  assert.equal(sig.triageScore, 68);
  assert.equal(TRIAGE_BAND_LABELS[sig.triageBand], "Worth a look");
  assert.equal(TRIAGE_CONFIDENCE_LABELS[sig.triageConfidence], "from title only");
});

test("a row with no triage tags yields nulls, so nothing renders", () => {
  const sig = jobSignals({ notes: "market=india; source=ats" });
  assert.equal(sig.triageScore, null);
  assert.equal(sig.triageBand, null);
  assert.equal(sig.triageConfidence, null);
});
