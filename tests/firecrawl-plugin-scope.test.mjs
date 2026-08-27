// tests/firecrawl-plugin-scope.test.mjs
//
// The Firecrawl plugin is a SECOND entry point into Tier 3. careers-scan.mjs
// enforces that tier's scope in code precisely so the mode file is not trusted
// to have been followed; a second door into the same tier is a bypass around
// that unless it carries the same rules.
//
// So these assertions are not about the plugin working — they are about it
// refusing. The failure this guards is a future edit that relaxes one rule to
// make a search "just work", which would silently reopen LinkedIn/Naukri
// scraping through a route AGENTS.md forbids by any means.

import { pass, fail } from './helpers.mjs';
import plugin, { entryScopeViolation, resultScopeViolation, hostOf } from '../plugins/firecrawl/index.mjs';

console.log('\n🔥 firecrawl plugin — Tier 3 scope is enforced in code');

// ── Rule 1: include_domains is required ──────────────────────────────────
{
  const cases = [
    ['absent', { name: 'x', query: 'pm' }],
    ['empty array', { name: 'x', query: 'pm', include_domains: [] }],
    ['not an array', { name: 'x', query: 'pm', include_domains: 'zoho.com' }],
  ];
  for (const [label, entry] of cases) {
    const v = entryScopeViolation(entry);
    if (v && /include_domains/.test(v)) pass(`include_domains ${label} → refused`);
    else fail(`include_domains ${label} should be refused, got: ${v}`);
  }
  const ok = entryScopeViolation({ name: 'Zoho', query: 'pm', include_domains: ['zoho.com'] });
  if (ok === null) pass('a scoped employer domain is allowed');
  else fail(`a scoped employer domain should be allowed, got: ${ok}`);
}

// ── Rule 2: the scope must be an EMPLOYER domain ─────────────────────────
// These two are the ones that matter most: AGENTS.md forbids scraping LinkedIn
// and Naukri by ANY route, and "via Firecrawl" is still that route.
{
  const forbidden = [
    'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.co.in',
    'instahyre.com', 'foundit.in',
    'boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com',
    'acme.myworkdayjobs.com', 'icims.com',
  ];
  let refused = 0;
  for (const host of forbidden) {
    const v = entryScopeViolation({ name: 'x', query: 'pm', include_domains: [host] });
    if (v && /aggregator or ATS/.test(v)) refused++;
    else fail(`scoping to ${host} should be refused, got: ${v}`);
  }
  if (refused === forbidden.length) {
    pass(`all ${forbidden.length} aggregator/ATS hosts refused as a search scope (incl. LinkedIn, Naukri)`);
  }

  // A legitimate lookalike must NOT be caught — the suffix-boundary match is
  // the reason isNonEmployerHost is shared rather than reimplemented here.
  const lookalike = entryScopeViolation({ name: 'x', query: 'pm', include_domains: ['notlinkedin.com'] });
  if (lookalike === null) pass('notlinkedin.com is not mistaken for linkedin.com');
  else fail(`notlinkedin.com should be allowed, got: ${lookalike}`);
}

// ── Rule 3: individual ATS-hosted results are refused, not ingested ──────
{
  const v = resultScopeViolation('https://boards.greenhouse.io/acme/jobs/123');
  if (v && /Tier 2 missed a tenant/.test(v)) {
    pass('an ATS-hosted result is refused, and the reason names the real fix (seed the tenant)');
  } else {
    fail(`an ATS-hosted result should be refused with the seeding hint, got: ${v}`);
  }

  if (resultScopeViolation('https://www.zoho.com/careers/jobs/456') === null) {
    pass('an employer-domain result is accepted');
  } else {
    fail('an employer-domain result should be accepted');
  }

  if (resultScopeViolation('not a url')) pass('an unparseable URL is refused');
  else fail('an unparseable URL should be refused');
}

// ── The provider contract ────────────────────────────────────────────────
{
  if (plugin?.provider?.id === 'firecrawl') pass('exports provider.id "firecrawl"');
  else fail('provider.id must be "firecrawl"');

  if (plugin.provider.detect() === null) pass('detect() returns null — keyed providers never auto-detect');
  else fail('detect() must return null');

  if (hostOf('https://WWW.Zoho.com/careers') === 'zoho.com') pass('hostOf lowercases and strips www.');
  else fail(`hostOf normalization wrong: ${hostOf('https://WWW.Zoho.com/careers')}`);
}

// ── No key, no call ──────────────────────────────────────────────────────
{
  const saved = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    await plugin.provider.fetch({ name: 'x', query: 'pm', include_domains: ['zoho.com'] }, { env: {} });
    fail('fetch() without a key should throw');
  } catch (e) {
    if (/FIRECRAWL_API_KEY not set/.test(e.message)) pass('fetch() without a key throws before any network call');
    else fail(`wrong error without a key: ${e.message}`);
  } finally {
    if (saved !== undefined) process.env.FIRECRAWL_API_KEY = saved;
  }
}

// ── Scope is checked BEFORE the key is spent ─────────────────────────────
// Ordering matters: a scoped-to-LinkedIn entry must be refused on principle,
// not merely fail later at the API. With a key present, the refusal must still
// be the scope one.
{
  const saved = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'fc-test-not-a-real-key';
  try {
    await plugin.provider.fetch({ name: 'x', query: 'pm', include_domains: ['linkedin.com'] }, { env: {} });
    fail('a LinkedIn-scoped entry should throw even with a key present');
  } catch (e) {
    if (/aggregator or ATS/.test(e.message)) pass('scope is refused before the key is spent — no network call for a forbidden host');
    else fail(`expected a scope refusal, got: ${e.message}`);
  } finally {
    if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = saved;
  }
}
