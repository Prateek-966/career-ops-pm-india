// tests/pm-title-filter.test.mjs — the PM title filter in portals.yml admits the
// full PM surface and rejects only genuine non-PM roles (PRD v2 §A1.1).
//
// This freezes two PRD acceptance criteria that are otherwise unobservable:
//
//   "Zero product-marketing roles reaching evaluation"
//       Product marketing is the highest-volume false positive in any PM
//       search and a different discipline. It must die at the title layer,
//       before it costs an evaluation.
//
//   "A narrow title filter silently removes roles that would have scored
//    well — the worst failure mode in the system, because it is invisible."
//       The scan summary reports one "filtered by title" count and cannot
//       distinguish a well-tuned filter from a leaking one. So the
//       should-PASS list below is the more important half of this file: it is
//       the only place a narrowing of the filter becomes visible.
//
// The filter is compiled through the REAL title-keywords.mjs, from the REAL
// portals.yml, so a change to either is caught here rather than at scan time.

import { pass, fail, warn, ROOT } from './helpers.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { buildTitleFilter } from '../title-keywords.mjs';

console.log('\nPM title filter — portals.yml admits the PM surface, rejects non-PM');

// portals.yml is a user-layer file (gitignored upstream; committed in this
// fork). A checkout without one is a valid state — doctor.mjs reports it as
// onboarding — so this is a skip, not a failure.
const PORTALS = join(ROOT, 'portals.yml');
if (!existsSync(PORTALS)) {
  warn('portals.yml not present in this checkout — skipping the PM title-filter check');
} else {
  const cfg = yaml.load(readFileSync(PORTALS, 'utf8'));
  const tf = cfg?.title_filter;

  if (!tf || !Array.isArray(tf.positive) || tf.positive.length === 0) {
    fail('portals.yml has no title_filter.positive — an empty positive list matches EVERY title');
  } else {
    pass(`title_filter compiled (${tf.positive.length} positive, ${(tf.negative || []).length} negative)`);

    const matches = buildTitleFilter(tf);

    // Titles that MUST reach the rubric. Spread deliberately across the
    // archetype ladder in config/profile.yml — primary, secondary AND adjacent
    // — plus the domain-neutral titles that carry no domain word at all, which
    // is precisely what a domain-keyword positive list would lose.
    const mustPass = [
      // Bare and levelled
      'Product Manager',
      'Senior Product Manager',
      'Principal Product Manager',
      'Lead Product Manager',
      'Group Product Manager',
      'Head of Product',
      'Director of Product',
      'Director, Product Management',
      'Product Owner',
      'Senior Product Owner',
      'Product Lead, Marketplace',
      'Senior PM, Payments',
      'Technical Program Manager',
      'Director of Product Strategy',
      // Primary archetypes
      'Product Manager, Platform & APIs',
      'Senior Product Manager (Data Platform)',
      'Senior Product Manager - Supply Chain',
      'Senior AI Product Manager',
      'Enterprise Product Manager, B2B SaaS',
      // Secondary archetypes
      'Principal PM - Integrations',
      'Product Manager, ERP & Business Systems',
      'Senior Product Manager, OSS/BSS',
      'Analytics Product Manager',
      // Domain-neutral titles at domain-heavy companies — the case the PRD
      // singles out: "a 'Senior Product Manager' title at a supply chain
      // company carries no domain word at all".
      'Senior Product Manager II',
      'Product Manager III',
      'Product Management Lead',
    ];

    // Titles that must NOT cost an evaluation.
    const mustReject = [
      // The headline criterion.
      'Product Marketing Manager',
      'Senior Product Marketing Manager',
      'Director of Product Marketing',
      // Different disciplines wearing the word "product".
      'Product Designer',
      'Senior Product Designer',
      'Product Engineer',
      'Senior Product Engineer',
      'Product Support Specialist',
      'Product Specialist',
      // Sub-baseline seniority for this candidate.
      'Associate Product Manager',
      'Assistant Product Manager',
      'Product Management Intern',
      'Product Manager Internship',
      'Product Management Trainee',
      // The reason `word:pm` is anchored rather than a bare "pm" substring.
      'PMO Lead',
      'PMP Certified Delivery Manager',
      'Program Management Office Manager',
      // Plainly not PM.
      'Software Engineer',
      'Engineering Manager',
      'Data Analyst',
    ];

    const missed = mustPass.filter(t => !matches(t));
    if (missed.length === 0) {
      pass(`all ${mustPass.length} PM titles reach the rubric`);
    } else {
      fail(`title filter is too narrow — ${missed.length} PM title(s) silently dropped: ${missed.join(' | ')}`);
    }

    const leaked = mustReject.filter(t => matches(t));
    if (leaked.length === 0) {
      pass(`all ${mustReject.length} non-PM titles rejected before evaluation`);
    } else {
      fail(`title filter leaks — ${leaked.length} non-PM title(s) would be evaluated: ${leaked.join(' | ')}`);
    }

    // Product marketing gets its own assertion so the failure names the
    // criterion rather than hiding inside the bulk list above.
    const marketing = ['Product Marketing Manager', 'Senior Product Marketing Manager', 'Product Marketing Lead'];
    if (marketing.every(t => !matches(t))) {
      pass('zero product-marketing roles reach evaluation');
    } else {
      fail('product-marketing roles reach evaluation — PRD acceptance criterion violated');
    }

    // The positive list must stay domain-free. A domain word here re-creates
    // the narrow filter the whole architecture is arranged to avoid, and it
    // would do so invisibly.
    const DOMAIN_WORDS = ['ai', 'ml', 'genai', 'llm', 'data', 'supply chain', 'fintech', 'saas', 'platform', 'api'];
    const positives = tf.positive.filter(k => typeof k === 'string').map(k => k.toLowerCase());
    const domainy = positives.filter(k => DOMAIN_WORDS.includes(k.replace(/^word:/, '').trim()));
    if (domainy.length === 0) {
      pass('positive list is domain-free — domain fit stays a rubric dimension');
    } else {
      fail(`domain keyword(s) in title_filter.positive: ${domainy.join(', ')} — this narrows the scan invisibly (PRD §A1.1)`);
    }
  }
}
