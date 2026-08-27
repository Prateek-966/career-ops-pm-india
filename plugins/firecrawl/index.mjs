// @ts-check
//
// Firecrawl provider plugin — Tier 3 of the discovery model (PRD v2 §B4):
// company career pages that no supported ATS covers.
//
// ── Why this exists as a keyed provider ───────────────────────────────────
//
// `careers-scan.mjs` already runs Tier 3, but at the AGENT layer: an agent with
// the Firecrawl MCP tool fetches the rows and pipes them in. A Next.js server
// has no MCP tools, so the hosted dashboard could never reach that tier. This
// plugin closes that gap by calling Firecrawl's REST API directly with a key.
//
// As a KEYED provider it lives in plugins/ rather than the zero-key providers/
// dir, and fires ONLY on a portals.yml entry that sets `provider: firecrawl` —
// never via auto-detection. Same rule the Apify plugin follows.
//
// ── The scope rules are enforced HERE, not documented elsewhere ───────────
//
// careers-scan.mjs enforces Tier 3's scope in code precisely so the mode file
// is not trusted to have been followed. A second entry point into the same tier
// would be a bypass around that if it did not carry the same rules, so it does:
//
//   1. `include_domains` is REQUIRED. An unscoped Firecrawl search is a sweep
//      of the open web, which is not this tier and not what the key is for.
//   2. The scoped domains must be EMPLOYER domains. You cannot point this at
//      linkedin.com or naukri.com — scraping those is forbidden by AGENTS.md
//      by any route, and "via Firecrawl" is still that route.
//   3. Individual results on an aggregator or ATS host are REFUSED, not
//      ingested. An ATS-hosted hit means Tier 2's probe missed a tenant; the
//      fix is to seed that tenant so Tier 2 owns the company properly, not to
//      launder the posting through Tier 3 and leave the coverage gap in place.
//
// Rules 2 and 3 share `isNonEmployerHost` with add-company.mjs, so the three
// entry points into the pipeline cannot disagree about what an employer domain
// is — that divergence is how one of them ends up silently permissive.

import { isNonEmployerHost, normalizeHost } from '../../add-company.mjs';
import { hasKey, search } from './_firecrawl.mjs';

/**
 * Hostname of a URL, or '' when it will not parse.
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  try {
    return normalizeHost(new URL(String(url)).hostname);
  } catch {
    return '';
  }
}

/**
 * Why this entry may not be searched, or null when it is in scope.
 *
 * Returns a reason string rather than a boolean so the scanner can print WHICH
 * rule was broken — a refusal nobody can explain gets worked around.
 *
 * @param {{name?: string, include_domains?: unknown}} entry
 * @returns {string|null}
 */
export function entryScopeViolation(entry) {
  const label = entry?.name || '(unnamed entry)';
  const domains = entry?.include_domains;
  if (!Array.isArray(domains) || domains.length === 0) {
    return `firecrawl: entry ${label} has no 'include_domains'. An unscoped search is a sweep of the open web, not a Tier 3 careers-page scan.`;
  }
  for (const d of domains) {
    if (typeof d !== 'string' || !d.trim()) {
      return `firecrawl: entry ${label} has a non-string entry in 'include_domains'.`;
    }
    if (isNonEmployerHost(d)) {
      return `firecrawl: entry ${label} scopes to ${d}, which is an aggregator or ATS host. Tier 3 searches an employer's OWN site; LinkedIn and Naukri are manual-discovery surfaces and are never scraped, by any route.`;
    }
  }
  return null;
}

/**
 * Why this individual result may not be ingested, or null when it is fine.
 * @param {string} url
 * @returns {string|null}
 */
export function resultScopeViolation(url) {
  const host = hostOf(url);
  if (!host) return 'unparseable URL';
  if (isNonEmployerHost(host)) {
    return `hosted on ${host} (aggregator/ATS) — Tier 2 missed a tenant; seed it rather than routing the posting through Tier 3`;
  }
  return null;
}

export default {
  provider: {
    id: 'firecrawl',
    // Keyed providers never auto-detect (the engine also forces this to null).
    detect() { return null; },

    /**
     * @param {any} entry portals.yml entry with provider: firecrawl
     * @param {any} ctx   plugin context (scoped env)
     */
    async fetch(entry, ctx) {
      const key = ctx?.env?.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY;
      if (!hasKey(key)) {
        throw new Error('FIRECRAWL_API_KEY not set — enable firecrawl in config/plugins.yml and add the key to .env');
      }
      if (!entry?.query || typeof entry.query !== 'string') {
        throw new Error(`firecrawl: entry ${entry?.name || '(unnamed)'} missing 'query' (e.g. "product manager")`);
      }
      const violation = entryScopeViolation(entry);
      if (violation) throw new Error(violation);

      const results = await search(
        {
          query: entry.query,
          includeDomains: entry.include_domains,
          limit: entry.limit,
          location: entry.location_hint,
        },
        { key, timeoutMs: entry.timeout_ms },
      );

      const jobs = [];
      for (const r of results) {
        const url = String(r?.url || '').trim();
        const title = String(r?.title || '').trim();
        if (!url || !title) continue;
        if (resultScopeViolation(url)) continue;
        jobs.push({
          title,
          url,
          // The employer is whatever the portals.yml entry declares. NEVER
          // guessed from the result: a careers page title is not a company
          // name, and a wrong employer poisons dedupe and the tracker.
          company: entry.company || entry.name || '',
          location: entry.location || '',
        });
      }
      return jobs;
    },
  },
};
