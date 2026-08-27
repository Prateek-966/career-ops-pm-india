// Firecrawl transport helper — domain-restricted web search.
// Used by the Firecrawl provider plugin (plugins/firecrawl/index.mjs).
//
// Egress note: mirrors the reasoning in plugins/apify/_apify.mjs. Every request
// is built from this single hardcoded base, so it can only ever reach
// api.firecrawl.dev; the manifest's allowedHosts mirrors that for doctor and
// review visibility. Files prefixed with _ are never discovered as plugins.
//
// SEARCH, not crawl. Firecrawl also exposes /scrape and /crawl; this helper
// deliberately binds to /search only. That is what makes Tier 3's scope
// structural rather than a matter of discipline: a sweep is a domain-restricted
// search of one company's own site, and there is no open-ended crawl reachable
// from here to accidentally perform.

const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 60_000;

export function hasKey(key = process.env.FIRECRAWL_API_KEY) {
  return Boolean(key && String(key).trim());
}

/**
 * Run one domain-restricted search.
 *
 * @param {object} params
 * @param {string} params.query
 * @param {string[]} params.includeDomains  Hostnames the search is confined to.
 * @param {number} [params.limit]
 * @param {string} [params.location]
 * @param {object} opts
 * @param {string} opts.key
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<{url: string, title: string, description: string}>>}
 */
export async function search({ query, includeDomains, limit, location }, opts) {
  if (!hasKey(opts?.key)) {
    throw new Error('FIRECRAWL_API_KEY not set');
  }
  // `Number(limit) || 20` would be wrong: 0 is falsy, so an explicit
  // `limit: 0` in portals.yml would silently become a 20-result search and
  // spend credits the config asked not to spend. Fall back to the default only
  // when the value is absent or not a number; clamp anything numeric.
  const n = Number(limit);
  const boundedLimit = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.trunc(n))) : 20;

  const body = {
    query,
    limit: boundedLimit,
    includeDomains,
  };
  if (location) body.location = location;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${FIRECRAWL_API_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Status + reason phrase only — never the body, which can echo the query
    // and, on some errors, fragments of the request including the key.
    throw new Error(`firecrawl: search failed (HTTP ${res.status} ${res.statusText})`);
  }

  const json = await res.json();
  const web = json?.data?.web;
  return Array.isArray(web) ? web : [];
}
