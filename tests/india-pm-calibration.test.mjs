// tests/india-pm-calibration.test.mjs — the 15-JD calibration set (PRD v2 §A1
// acceptance) is well-composed, and the title filter agrees with it.
//
// The PRD's Part A acceptance has four criteria. Two are deterministic and are
// asserted here against REAL postings; two need a cv.md and are checked by hand
// (see evals/india-pm/README.md):
//
//   ✓ zero product-marketing roles reaching evaluation      → asserted here
//   ✓ the set spans the required range                      → asserted here
//   ✗ GCC/product classification correct on >= 90%          → manual, needs a run
//   ✗ >= 1 strong non-AI role scores >= 4                   → manual, needs cv.md
//
// tests/pm-title-filter.test.mjs already guards the filter against a
// hand-written list. This file is the harder version of that guard: the titles
// here are real postings returned by real India PM searches, including the ones
// that are awkward on purpose — "Lead Product Supply Chain Manager, India"
// (contains Product and Manager, is not a PM role) and
// "IN_Senior Associate_Product Manager - AI Products__GCC_Advisory_Bangalore"
// (a requisition-code title that a naive matcher mangles).
//
// The composition assertions matter as much as the filter ones. The PRD is
// explicit that a set which only contains AI roles cannot detect a covertly
// AI-only rubric — "if only AI roles score well, the rubric is still covertly
// narrow". A calibration set that quietly drifts to all-AI would disarm the
// one check designed to catch that, silently.

import { pass, fail, ROOT } from './helpers.mjs';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { buildTitleFilter } from '../title-keywords.mjs';
import { marketOf } from '../market-map.mjs';

console.log('\nIndia PM calibration set — composition + title-filter agreement');

const DIR = join(ROOT, 'evals', 'india-pm');
const PORTALS_TEMPLATE = join(ROOT, 'templates', 'portals.pm-india.yml');

if (!existsSync(DIR)) {
  fail('evals/india-pm/ is missing — the PRD requires the calibration set to be recorded in evals/');
} else if (!existsSync(PORTALS_TEMPLATE)) {
  fail('templates/portals.pm-india.yml is missing — cannot compile the title filter to check the set against');
} else {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  /** @type {any[]} */
  const cases = [];
  let malformed = 0;
  for (const f of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      // A case with no label is worse than a missing case: it silently shrinks
      // every denominator below.
      if (!parsed?.id || !parsed?.title || !parsed?.label) {
        fail(`evals/india-pm/${f}: needs id, title and label`);
        malformed += 1;
        continue;
      }
      cases.push(parsed);
    } catch (e) {
      fail(`evals/india-pm/${f}: not valid JSON — ${e.message}`);
      malformed += 1;
    }
  }

  if (malformed === 0) pass(`${cases.length} calibration cases parsed`);

  // ── Composition: the set must span the range the PRD names ────────────────

  if (cases.length >= 15) {
    pass(`set has ${cases.length} cases (PRD requires 15)`);
  } else {
    fail(`set has ${cases.length} cases — the PRD requires 15 real JDs`);
  }

  const nonAi = cases.filter((c) => c.label.is_ai_role === false);
  if (nonAi.length >= 5) {
    pass(`${nonAi.length} non-AI cases (PRD requires >= 5)`);
  } else {
    fail(`only ${nonAi.length} non-AI cases — the PRD requires >= 5 from non-AI domains, because a set of only AI roles cannot detect a covertly AI-only rubric`);
  }

  const types = new Set(cases.map((c) => c.label.company_type));
  const missingTypes = ['gcc', 'product', 'unclear'].filter((t) => !types.has(t));
  if (missingTypes.length === 0) {
    pass('set contains gcc, product AND unclear cases');
  } else {
    fail(`calibration set has no ${missingTypes.join('/')} case — the GCC dimension cannot be calibrated without all three`);
  }

  // "deliberately spanning the range — GCC and product company, Indian startup
  // and international remote".
  const markets = new Set(cases.map((c) => marketOf(c.location)));
  if (markets.has('india')) pass('set contains India-located roles');
  else fail('calibration set has no India-located role');

  const remote = cases.filter((c) => /remote/i.test(String(c.location || '')));
  if (remote.length > 0) {
    pass(`${remote.length} international/remote case(s) present`);
  } else {
    fail('calibration set has no international-remote case — the PRD asks the set to span that axis');
  }

  // The unknown-market bucket must be exercised by a real posting, not only by
  // a unit-test fixture: "Remote" with no country is the shape that actually
  // shows up, and it is the one §B7 says to surface rather than drop.
  const unknownMarket = cases.filter((c) => marketOf(c.location) === 'unknown');
  if (unknownMarket.length > 0) {
    pass(`${unknownMarket.length} case(s) normalize to market=unknown — the bucket is exercised by real data`);
  } else {
    fail('no calibration case lands in market=unknown — the surfaced-not-dropped path is untested against real postings');
  }

  const tiers = new Set(cases.map((c) => c.label.domain_tier).filter(Boolean));
  if (tiers.has('primary') && tiers.has('secondary') && (tiers.has('transferable') || tiers.has('weak'))) {
    pass(`domain tiers spanned: ${[...tiers].sort().join(', ')}`);
  } else {
    fail(`domain tiers too narrow (${[...tiers].sort().join(', ')}) — the set should reach primary, secondary and at least one unlisted domain`);
  }

  // Every case needs a quotable reason for its classification. A label with no
  // evidence cannot be reviewed, and an unreviewable label is how a wrong one
  // survives a calibration pass.
  const noEvidence = cases.filter((c) => typeof c.label.company_type_evidence !== 'string' || c.label.company_type_evidence.length < 40);
  if (noEvidence.length === 0) {
    pass('every case records the evidence for its company_type label');
  } else {
    fail(`${noEvidence.length} case(s) have no company_type_evidence: ${noEvidence.map((c) => c.id).join(', ')}`);
  }

  // ── Title-filter agreement, against real posting titles ───────────────────

  const cfg = yaml.load(readFileSync(PORTALS_TEMPLATE, 'utf8'));
  const matches = buildTitleFilter(cfg?.title_filter);

  const disagreements = [];
  for (const c of cases) {
    const expected = c.expect_title_filter;
    if (expected !== 'pass' && expected !== 'reject') {
      fail(`evals/india-pm/${c.id}.json: expect_title_filter must be "pass" or "reject"`);
      continue;
    }
    const actual = matches(c.title) ? 'pass' : 'reject';
    if (actual !== expected) disagreements.push(`${c.id} ("${c.title}") expected ${expected}, got ${actual}`);
  }

  if (disagreements.length === 0) {
    pass(`title filter agrees with all ${cases.length} real posting titles`);
  } else {
    fail(`title filter disagrees on ${disagreements.length} real posting(s):\n    ${disagreements.join('\n    ')}`);
  }

  // The PRD names this criterion explicitly, so it gets its own assertion
  // rather than hiding inside the bulk agreement above.
  const admitted = cases.filter((c) => matches(c.title));
  const marketingLeaks = admitted.filter((c) => /product\s+marketing/i.test(c.title));
  if (marketingLeaks.length === 0) {
    pass('zero product-marketing roles reach evaluation (real postings)');
  } else {
    fail(`product-marketing roles admitted: ${marketingLeaks.map((c) => c.title).join(', ')}`);
  }

  // At least one non-AI role must survive the filter, or the ">= 1 strong
  // non-AI role scores >= 4" criterion is unreachable before scoring even
  // begins — and it would fail for a reason nobody would look for.
  const nonAiAdmitted = nonAi.filter((c) => matches(c.title));
  if (nonAiAdmitted.length > 0) {
    pass(`${nonAiAdmitted.length} non-AI role(s) reach the rubric — the >= 4 criterion is reachable`);
  } else {
    fail('no non-AI role survives the title filter — the non-AI scoring criterion cannot be met at all');
  }
}
