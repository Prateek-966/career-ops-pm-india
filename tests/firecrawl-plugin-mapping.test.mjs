// tests/firecrawl-plugin-mapping.test.mjs
//
// The scope test (firecrawl-plugin-scope) freezes what the plugin REFUSES.
// This one covers what it does when it proceeds: the exact request put on the
// wire, and how a response becomes pipeline rows.
//
// It stubs globalThis.fetch rather than calling Firecrawl, so it runs offline
// and costs no credits. That leaves exactly one thing unverified — whether
// api.firecrawl.dev really accepts this request shape — which no offline test
// can settle and which is recorded honestly rather than implied.

import { pass, fail } from './helpers.mjs';
import plugin from '../plugins/firecrawl/index.mjs';

console.log('\n🔥 firecrawl plugin — request shape and result mapping');

const KEY = 'fc-test-key-not-real';

/** Install a fake fetch, run fn, restore. Returns what the fake captured. */
async function withStub(response, fn) {
  const real = globalThis.fetch;
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.method = init?.method;
    seen.headers = init?.headers;
    seen.body = init?.body ? JSON.parse(init.body) : null;
    return {
      ok: response.ok !== false,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      json: async () => response.json,
    };
  };
  try {
    seen.result = await fn();
  } catch (e) {
    seen.error = e;
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

const entry = {
  name: 'Zoho — Product Manager',
  company: 'Zoho',
  query: 'product manager',
  include_domains: ['zoho.com'],
  limit: 5,
  location: 'Chennai, India',
};

// ── The request actually put on the wire ─────────────────────────────────
{
  const seen = await withStub(
    { json: { success: true, data: { web: [] } } },
    () => plugin.provider.fetch(entry, { env: { FIRECRAWL_API_KEY: KEY } }),
  );

  if (seen.url === 'https://api.firecrawl.dev/v2/search') pass('POSTs to api.firecrawl.dev/v2/search');
  else fail(`wrong endpoint: ${seen.url}`);

  if (seen.method === 'POST') pass('uses POST');
  else fail(`wrong method: ${seen.method}`);

  if (seen.headers?.Authorization === `Bearer ${KEY}`) pass('sends the key as a Bearer token');
  else fail(`wrong Authorization header: ${seen.headers?.Authorization}`);

  if (seen.body?.query === 'product manager') pass('passes the query through');
  else fail(`wrong query: ${seen.body?.query}`);

  // The scope must reach the API, not merely be checked locally — otherwise a
  // paid search sweeps the open web and the local check bought nothing.
  if (Array.isArray(seen.body?.includeDomains) && seen.body.includeDomains[0] === 'zoho.com') {
    pass('includeDomains reaches the API — the scope is enforced server-side too, not just locally');
  } else {
    fail(`includeDomains missing from the request body: ${JSON.stringify(seen.body?.includeDomains)}`);
  }

  if (seen.body?.limit === 5) pass('honours limit');
  else fail(`wrong limit: ${seen.body?.limit}`);
}

// ── limit is clamped, so a config typo cannot bill for 100k results ──────
{
  for (const [given, want] of [[0, 1], [-3, 1], [9999, 100], [undefined, 20]]) {
    const seen = await withStub(
      { json: { success: true, data: { web: [] } } },
      () => plugin.provider.fetch({ ...entry, limit: given }, { env: { FIRECRAWL_API_KEY: KEY } }),
    );
    if (seen.body?.limit === want) pass(`limit ${given} → ${want}`);
    else fail(`limit ${given} should clamp to ${want}, got ${seen.body?.limit}`);
  }
}

// ── Mapping a realistic response ─────────────────────────────────────────
{
  const seen = await withStub(
    {
      json: {
        success: true,
        data: {
          web: [
            { url: 'https://www.zoho.com/careers/jobs/pm-1', title: 'Product Manager — Zoho CRM', description: '...' },
            // ATS-hosted: must be dropped, not ingested (Tier 2 missed a tenant).
            { url: 'https://boards.greenhouse.io/other/jobs/9', title: 'Product Manager', description: '...' },
            // LinkedIn: must be dropped even if Firecrawl returns it.
            { url: 'https://www.linkedin.com/jobs/view/123', title: 'Product Manager', description: '...' },
            { url: 'https://zoho.com/careers/jobs/pm-2', title: 'Senior Product Manager', description: '...' },
            { url: '', title: 'No URL', description: '...' },
            { url: 'https://zoho.com/careers/jobs/pm-3', title: '', description: '...' },
          ],
        },
      },
    },
    () => plugin.provider.fetch(entry, { env: { FIRECRAWL_API_KEY: KEY } }),
  );

  const jobs = seen.result || [];
  if (jobs.length === 2) pass('6 results → 2 kept (ATS, LinkedIn, no-URL and no-title all dropped)');
  else fail(`expected 2 kept, got ${jobs.length}: ${JSON.stringify(jobs.map(j => j.url))}`);

  if (!jobs.some(j => /greenhouse|linkedin/.test(j.url))) {
    pass('no aggregator or ATS URL survives into the pipeline');
  } else {
    fail('an aggregator/ATS URL leaked into the results');
  }

  // The employer must come from the entry. A careers-page title is not a
  // company name, and a wrong employer poisons dedupe and the tracker.
  if (jobs.every(j => j.company === 'Zoho')) pass('company comes from the portals entry, never guessed from the result');
  else fail(`company wrong: ${JSON.stringify(jobs.map(j => j.company))}`);

  if (jobs.every(j => j.location === 'Chennai, India')) pass('location is carried from the entry');
  else fail(`location wrong: ${JSON.stringify(jobs.map(j => j.location))}`);

  if (jobs[0]?.title === 'Product Manager — Zoho CRM') pass('title comes from the result');
  else fail(`title wrong: ${jobs[0]?.title}`);
}

// ── A non-2xx never leaks the response body ─────────────────────────────
// Firecrawl error bodies can echo the request, which includes the key.
{
  const seen = await withStub(
    { ok: false, status: 401, statusText: 'Unauthorized', json: { error: 'bad key fc-SECRET-LEAK' } },
    () => plugin.provider.fetch(entry, { env: { FIRECRAWL_API_KEY: KEY } }),
  );
  const msg = seen.error?.message || '';
  if (/401/.test(msg) && /Unauthorized/.test(msg)) pass('an API error surfaces status + reason phrase');
  else fail(`unhelpful error: ${msg}`);
  if (!/SECRET-LEAK/.test(msg)) pass('the response body is never included in the error — it can echo the key');
  else fail('the error leaked the response body');
}

// ── A malformed payload yields no rows rather than throwing ─────────────
{
  for (const [label, json] of [
    ['data.web missing', { success: true, data: {} }],
    ['data missing', { success: true }],
    ['web not an array', { success: true, data: { web: 'nope' } }],
  ]) {
    const seen = await withStub({ json }, () => plugin.provider.fetch(entry, { env: { FIRECRAWL_API_KEY: KEY } }));
    if (!seen.error && Array.isArray(seen.result) && seen.result.length === 0) pass(`${label} → 0 rows, no throw`);
    else fail(`${label} should yield 0 rows, got error=${seen.error?.message} result=${JSON.stringify(seen.result)}`);
  }
}
