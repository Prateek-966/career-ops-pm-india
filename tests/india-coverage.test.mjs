// tests/india-coverage.test.mjs — the India coverage tier scripts (PRD v2 Part B).
//
// Covers india-scan.mjs (Tier 1: Indeed MCP results -> deduped pipeline rows)
// and add-company.mjs (§B6: one manual sighting -> permanent coverage).
//
// Both are tested through their PURE exports, against fixtures — no network, no
// MCP call, no writes to data/. The scripts' own file I/O is thin; the parts
// worth freezing are the ones that decide what enters the pipeline and what is
// silently dropped.
//
// Two of these assertions exist because the behaviour was wrong first:
//
//   - add-company's flag parsing excluded `websiteIdx + 1` unconditionally, so
//     with no `--website` flag the exclusion resolved to index 0 and ate the
//     company name. `node add-company.mjs "Acme"` reported "could not derive a
//     company name" for a perfectly good argument.
//
//   - The aggregator guard matters more than it looks: without it, pasting a
//     LinkedIn posting URL seeds the list with a company called "Linkedin",
//     which then gets probed and permanently pollutes the seed file.

import { pass, fail } from './helpers.mjs';
import { normalizeRow, extractRows, filterAndDedupe, tagOffer } from '../scan-ingest.mjs';
import { deriveCompany, isNonEmployerHost, companyKey, applyAddCompany } from '../add-company.mjs';
import { buildTitleFilter } from '../title-keywords.mjs';

console.log('\nIndia coverage — india-scan + add-company (PRD v2 Part B)');

// ── india-scan: row normalization ───────────────────────────────────────────

{
  const good = normalizeRow({
    title: ' Senior Product Manager ',
    company: 'Acme',
    location: 'Pune, Maharashtra',
    url: 'https://to.indeed.com/abc',
    postedAt: '2026-08-21',
    salary: '₹40,00,000 a year',
    jobId: 'JOBSEARCH_1',
  });
  if (good.ok && good.offer.title === 'Senior Product Manager' && good.offer.salary === '₹40,00,000 a year') {
    pass('normalizeRow trims fields and keeps salary verbatim');
  } else {
    fail(`normalizeRow mangled a good row: ${JSON.stringify(good)}`);
  }

  // Compensation must survive untouched and un-converted — PRD §B7: silent FX
  // inside a score is a correctness bug, and capture is the safest place to
  // guarantee no conversion happened.
  if (good.ok && !('salaryInr' in good.offer) && !/\d+\s*(USD|INR)$/.test(good.offer.salary)) {
    pass('no currency conversion happens at capture');
  } else {
    fail('a converted compensation figure appeared at capture time');
  }
}

{
  const bad = [
    [{ company: 'A', url: 'https://x.com/1' }, 'missing title'],
    [{ title: 'PM', company: 'A' }, 'missing url'],
    [{ title: 'PM', company: 'A', url: 'not-a-url' }, 'malformed url'],
    [{ title: 'PM', company: 'A', url: 'javascript:alert(1)' }, 'non-http url scheme'],
    [{ title: 'PM', url: 'https://x.com/1' }, 'missing company'],
    ['a string', 'row is not an object'],
    [null, 'row is not an object'],
  ];
  const wrong = bad.filter(([row, expect]) => {
    const out = normalizeRow(row);
    return out.ok || !out.reason.includes(expect);
  });
  if (wrong.length === 0) {
    pass(`normalizeRow rejects all ${bad.length} malformed rows with a reason`);
  } else {
    fail(`normalizeRow mishandled ${wrong.length} malformed row(s): ${JSON.stringify(wrong.map(w => w[1]))}`);
  }
}

{
  // A posting date that cannot be parsed is DROPPED, not coerced. The tracker's
  // POSTED column reads it as requisition age, so a guessed date reports a
  // months-old req as fresh.
  const out = normalizeRow({ title: 'PM', company: 'A', url: 'https://x.com/1', postedAt: 'sometime last spring' });
  if (out.ok && out.offer.postedAt === undefined) {
    pass('an unparseable postedAt is dropped rather than guessed');
  } else {
    fail(`unparseable postedAt was coerced to ${JSON.stringify(out.ok && out.offer.postedAt)}`);
  }
}

{
  const shapes = [
    [[{ a: 1 }], 'bare array'],
    [{ jobs: [{ a: 1 }] }, 'jobs key'],
    [{ results: [{ a: 1 }] }, 'results key'],
    [{ rows: [{ a: 1 }] }, 'rows key'],
    [{ items: [{ a: 1 }] }, 'items key'],
  ];
  const bad = shapes.filter(([input]) => extractRows(input).length !== 1);
  if (bad.length === 0 && extractRows({ nope: 1 }).length === 0) {
    pass('extractRows accepts every documented wrapper shape, rejects unknown ones');
  } else {
    fail('extractRows failed on a documented wrapper shape');
  }
}

// ── india-scan: filtering and the three dedupe levels ───────────────────────

{
  const matchesTitle = buildTitleFilter({
    positive: ['product manager', 'product owner'],
    negative: ['product marketing', 'associate product'],
  });
  const offer = (title, company, url, location = 'Pune') => ({ title, company, url, location });

  const batch = [
    offer('Senior Product Manager', 'Acme', 'https://x.com/1'),
    offer('Product Marketing Manager', 'Acme', 'https://x.com/2'),      // title-filtered
    offer('Associate Product Manager', 'Acme', 'https://x.com/3'),      // title-filtered
    offer('Senior Product Manager', 'Acme', 'https://x.com/4'),         // intra-batch role dupe
    offer('Product Owner', 'Beta', 'https://x.com/5'),
  ];

  const empty = { seen: new Set(), seenCompanyRoles: new Set() };
  const r = filterAndDedupe(batch, matchesTitle, empty);
  if (r.kept.length === 2 && r.filteredTitle === 2 && r.dupes === 1) {
    pass('filterAndDedupe: 2 kept, 2 title-filtered, 1 intra-batch role dupe');
  } else {
    fail(`filterAndDedupe wrong: kept=${r.kept.length} title=${r.filteredTitle} dupes=${r.dupes}`);
  }

  // A role already known from the ATS tier must not come back because Indeed
  // also indexes it — under a DIFFERENT url. This is the assertion that makes
  // "aggregators are indexes, the ATS is the source of truth" true in code.
  const withHistory = filterAndDedupe(
    [offer('Senior Product Manager', 'Acme', 'https://indeed.example/999')],
    matchesTitle,
    { seen: new Set(), seenCompanyRoles: new Set(['acme::senior product manager']) },
  );
  if (withHistory.kept.length === 0 && withHistory.dupes === 1) {
    pass('a role already known from the ATS tier is not re-added from Indeed');
  } else {
    fail('company+role dedupe against history failed — Indeed would duplicate ATS rows');
  }

  // A missing/!Set snapshot must not throw: loadDedupSnapshot can legitimately
  // return empty sets on a fresh checkout.
  try {
    const r2 = filterAndDedupe([offer('Product Manager', 'C', 'https://x.com/9')], matchesTitle, {});
    if (r2.kept.length === 1) pass('filterAndDedupe tolerates an empty dedupe snapshot');
    else fail('filterAndDedupe dropped a row against an empty snapshot');
  } catch (e) {
    fail(`filterAndDedupe threw on an empty snapshot: ${e.message}`);
  }
}

{
  const tagged = tagOffer({ title: 'PM', company: 'A', url: 'https://x.com/1', location: 'Bangalore, KA', sourceId: 'J1' }, 'indeed', 'indeed_id');
  if (tagged.market === 'india' && tagged.note === 'market=india; source=indeed; indeed_id=J1') {
    pass('tagOffer writes the market=/source= note spelling _custom.md declares');
  } else {
    fail(`tagOffer note drifted: ${JSON.stringify(tagged.note)}`);
  }

  // An unrecognised location is tagged unknown and still kept — surfaced, never
  // dropped (PRD §B7).
  const odd = tagOffer({ title: 'PM', company: 'A', url: 'https://x.com/2', location: 'Somewhere Else' }, 'indeed', 'indeed_id');
  if (odd.market === 'unknown' && odd.note.includes('market=unknown')) {
    pass('an unrecognised location is tagged market=unknown, not dropped');
  } else {
    fail(`unknown-market handling drifted: ${JSON.stringify(odd)}`);
  }
}

// ── add-company: derivation and the flag-parsing regression ─────────────────

{
  const cases = [
    ['Acme Corp', 'Acme Corp', null],
    ['https://acme.com/careers/senior-pm', 'Acme', 'acme.com'],
    ['https://acme.co.in/careers', 'Acme', 'acme.co.in'],
  ];
  const bad = cases.filter(([input, name, website]) => {
    const d = deriveCompany(input);
    return d.name !== name || d.website !== website;
  });
  if (bad.length === 0) pass('deriveCompany handles names and employer URLs');
  else fail(`deriveCompany wrong for: ${bad.map(b => b[0]).join(', ')}`);
}

{
  // The guard that stops the seed list filling up with "Linkedin" and "Indeed".
  const aggregators = [
    'https://www.linkedin.com/jobs/view/123',
    'https://in.naukri.com/job-listings-abc',
    'https://to.indeed.com/abc',
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://acme.wd3.myworkdayjobs.com/External',
    'https://jobs.lever.co/acme/1',
  ];
  const leaked = aggregators.filter(u => !deriveCompany(u).fromAggregator);
  if (leaked.length === 0) {
    pass(`all ${aggregators.length} aggregator/ATS URLs are refused, not name-guessed`);
  } else {
    fail(`aggregator URL(s) would seed a bogus company: ${leaked.join(', ')}`);
  }

  // Suffix matching must be on a boundary, or a real company is misclassified.
  if (!isNonEmployerHost('notlinkedin.com') && isNonEmployerHost('www.linkedin.com')) {
    pass('aggregator matching is on a domain boundary, not a substring');
  } else {
    fail('aggregator host matching is substring-based — it would refuse real companies');
  }
}

{
  const seed = 'companies:\n  - name: Existing\n    website: existing.com\n';

  const dup = applyAddCompany(seed, { name: 'existing' });
  if (dup.status === 'present' && dup.text === seed) {
    pass('applyAddCompany is idempotent across case and punctuation');
  } else {
    fail(`applyAddCompany re-added a present company: ${JSON.stringify(dup.status)}`);
  }

  const added = applyAddCompany(seed, { name: 'New Co', website: 'newco.in' });
  if (added.status === 'added' && added.text.includes('"New Co"') && added.text.includes('newco.in')) {
    pass('applyAddCompany appends a new company');
  } else {
    fail('applyAddCompany failed to append a new company');
  }

  // Appending must not round-trip the YAML: the seed file is heavily commented
  // and a yaml.dump would strip every comment in it.
  const commented = '# how to grow this list\ncompanies:\n  - name: Existing\n';
  const kept = applyAddCompany(commented, { name: 'Another' });
  if (kept.text.startsWith('# how to grow this list')) {
    pass('appending preserves the seed file comments');
  } else {
    fail('appending stripped the seed file comments — a yaml round-trip crept in');
  }

  if (companyKey('Acme Corp.') === companyKey('acme corp') && companyKey('Acme') !== companyKey('Acme Two')) {
    pass('companyKey folds case and punctuation without collapsing distinct names');
  } else {
    fail('companyKey normalization is wrong');
  }
}
