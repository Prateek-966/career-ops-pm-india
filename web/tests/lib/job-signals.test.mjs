// Tests for the India/PM card signals (PRD v2 Part C).
//
// Imports src/lib/job-signals.mjs directly — the single source the pipeline
// table, the explore cards and the score panel all read, so the test and the
// production path can never drift.
//
// The assertions that matter most here are the NEGATIVE ones. Two of the three
// signals must return null rather than a guess when the tracker row carries no
// tag, and it would be very easy to "improve" this file into inferring them:
//
//   - Guessing `ats` for an untagged row makes the provenance badge a lie on
//     every row added before the India work existed.
//   - Guessing `product` for an unlabelled company is exactly the silent guess
//     PRD §A1.3 forbids ("Ambiguous cases must be labelled `unclear` and
//     flagged for manual check. Never guess this one silently.").
//
// Run:  node --test tests/lib/job-signals.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNoteTags,
  jobSignals,
  countByMarket,
  SOURCE_LABELS,
  COMPANY_TYPE_LABELS,
} from "../../src/lib/job-signals.mjs";

test("parses the tag spelling the CLI writes", () => {
  const tags = parseNoteTags("market=india; source=indeed; indeed_id=JOBSEARCH_1");
  assert.deepEqual(tags, { market: "india", source: "indeed", indeed_id: "JOBSEARCH_1" });
});

test("accepts both ; and | segment separators", () => {
  // `; ` is the tracker Notes convention; a row carried over from a pipeline
  // line can arrive pipe-separated.
  assert.equal(parseNoteTags("market=india | source=ats").source, "ats");
  assert.equal(parseNoteTags("market=india; source=ats").source, "ats");
});

test("tolerates free-text notes with no tags at all", () => {
  for (const notes of ["fintech, Leeds", "", "   ", "no equals here", "=leading", undefined, null]) {
    assert.deepEqual(parseNoteTags(notes), {}, `notes: ${JSON.stringify(notes)}`);
  }
});

test("the first tag wins on a duplicate key", () => {
  // A hand-edited correction should not silently override the scanner's record.
  assert.equal(parseNoteTags("source=indeed; source=ats").source, "indeed");
});

test("reads all three signals off a fully tagged row", () => {
  const s = jobSignals({ notes: "market=india; source=indeed; org=gcc" });
  assert.equal(s.market, "india");
  assert.equal(s.marketLabel, "India");
  assert.equal(s.source, "indeed");
  assert.equal(s.companyType, "gcc");
});

test("market falls back to normalizing the location when untagged", () => {
  // Rows that predate the tag, or were pasted by hand, still get bucketed
  // rather than all landing in Unknown.
  assert.equal(jobSignals({ location: "Bangalore, KA" }).market, "india");
  assert.equal(jobSignals({ location: "Pune (Hybrid)" }).market, "india");
  assert.equal(jobSignals({ location: "London" }).market, "uk_eu");
});

test("an explicit market tag beats the location text", () => {
  // The CLI already normalized it once; a location string that mentions a
  // second city must not re-decide it here.
  assert.equal(jobSignals({ notes: "market=india", location: "London" }).market, "india");
});

test("an unrecognised location is unknown, and unknown is a real bucket", () => {
  const s = jobSignals({ location: "Somewhere Else" });
  assert.equal(s.market, "unknown");
  assert.equal(s.marketLabel, "Unknown market");
});

test("source is null when untagged — never inferred", () => {
  assert.equal(jobSignals({ location: "Pune" }).source, null);
  assert.equal(jobSignals({ notes: "via=Agency" }).source, null);
});

test("companyType is null when untagged — never guessed as product", () => {
  assert.equal(jobSignals({ location: "Pune" }).companyType, null);
  assert.equal(jobSignals({ notes: "market=india; source=ats" }).companyType, null);
});

test("unclear is a first-class companyType, not a fallback for missing", () => {
  assert.equal(jobSignals({ notes: "org=unclear" }).companyType, "unclear");
  // …and absent stays absent, so the UI can tell "we checked and could not
  // tell" apart from "nobody checked".
  assert.equal(jobSignals({ notes: "" }).companyType, null);
});

test("an out-of-vocabulary tag value is rejected, not passed through", () => {
  // Notes are hand-editable. A typo must not reach a Record lookup that has no
  // entry for it and render `undefined` into the badge.
  assert.equal(jobSignals({ notes: "source=naukri" }).source, null);
  assert.equal(jobSignals({ notes: "org=startup" }).companyType, null);
});

test("tag values are case-insensitive", () => {
  const s = jobSignals({ notes: "MARKET=India; Source=ATS; ORG=Product" });
  assert.equal(s.market, "india");
  assert.equal(s.source, "ats");
  assert.equal(s.companyType, "product");
});

test("the alternate machine-summary key spellings are accepted", () => {
  const s = jobSignals({ notes: "source_tier=firecrawl; company_type=product" });
  assert.equal(s.source, "firecrawl");
  assert.equal(s.companyType, "product");
});

test("never throws on a malformed or missing row", () => {
  for (const row of [{}, { notes: 42 }, { location: null }, {}]) {
    assert.doesNotThrow(() => jobSignals(row));
  }
});

test("countByMarket buckets a mixed list, unknown included", () => {
  const counts = countByMarket([
    { location: "Pune" },
    { location: "Bengaluru" },
    { location: "London" },
    { location: "Dubai" },
    { location: "Mars" },
    {},
  ]);
  assert.equal(counts.india, 2);
  assert.equal(counts.uk_eu, 1);
  assert.equal(counts.gulf, 1);
  assert.equal(counts.unknown, 2); // "Mars" and the row with no location
});

test("every vocabulary value has a display label", () => {
  // A missing label renders as `undefined` in a badge — silent, and only
  // visible to whoever happens to have that one row.
  for (const k of ["indeed", "ats", "firecrawl", "manual"]) {
    assert.equal(typeof SOURCE_LABELS[k], "string", `no label for source ${k}`);
  }
  for (const k of ["gcc", "product", "unclear"]) {
    assert.equal(typeof COMPANY_TYPE_LABELS[k], "string", `no label for companyType ${k}`);
  }
});
