# India job sources — investigated, adopted, and rejected

Required by PRD v2's definition of done: *"records every source investigated,
**including rejections and the reason**"*.

A rejection that is not written down gets re-investigated every few months, and
the second investigation reaches the same conclusion at the same cost. That is
the whole purpose of this file. **Append, never delete** — if a source's status
changes, add a dated row saying so rather than editing the history away.

---

## The organising principle

> **Aggregators are indexes. The ATS is the source of truth.**

Naukri, LinkedIn and Indeed listings overwhelmingly point back to a posting
hosted on Greenhouse, Lever, Ashby, Workday or SmartRecruiters — all of which
career-ops already supports, and all of which are company-agnostic. Indian
postings are therefore already reachable today without a single new scraper.

So coverage is built in tiers by **legitimacy and data quality**, not by
scraping breadth, and discovery is separated from retrieval: use an aggregator
to learn *which companies are hiring*, then pull the *canonical posting* from
the ATS.

---

## Tier status

| Tier | Source | Status | Mechanism |
|---|---|---|---|
| 1 | Indeed | **Adopted** | Official MCP connector (`modes/india-scan.md` → `india-scan.mjs`) |
| 2 | ATS-direct | **Adopted — primary engine** | `config/india-seed-companies.yml` → `discover-ats.mjs` → `portals.yml` → `scan.mjs` |
| 3 | Firecrawl | **Adopted, tightly scoped** | Seed-list companies only, where no ATS was detected |
| 4 | Instahyre / Cutshort | **Deferred — unverified** | See below; build only if Tiers 1–3 leave a measured gap |
| — | LinkedIn | **Rejected for automation** | Manual discovery surface only |
| — | Naukri | **Rejected for automation** | Manual discovery surface only |

---

## Tier 1 — Indeed via the official MCP connector ✅

**Status: adopted.** Sanctioned API access — no scraping, no ToS exposure, no
maintenance burden, and it works today with zero provider code.

| Tool | Use here |
|---|---|
| `search_jobs` | `country_code: "IN"` across the 5-location × 9-query matrix in `modes/india-scan.md`. Verified returning PM roles across Pune with apply URLs. |
| `get_job_details` | Full JD by `job_id`, feeding the evaluation pipeline directly. |
| `get_company_data` | Employee ratings, salary bands, culture, management — better structured than anything scraped, and one of the few rating sources that covers Indian GCCs. Feeds the rubric's company-research block. |
| `get_resume` | Indeed-hosted resume, if maintained. Not currently used. |

**Architectural decision:** integrated at the **agent layer**, not `providers/`.
There is no public keyed API behind the connector, so a `providers/indeed.mjs`
would have to be a scraper — the exact mistake this tier exists to avoid. The
agent calls the MCP tool; `india-scan.mjs` owns filtering, dedupe and writing.

**Known limitation:** Indeed is discovery *breadth*, not the backbone. If it
rate-limits or its coverage gaps, Tier 2 carries the search. That asymmetry is
deliberate — see the risk table in the PRD.

---

## Tier 2 — ATS-direct ✅ (the highest-quality tier)

**Status: adopted, and the primary coverage engine.** Entirely clean: these are
public, documented, company-agnostic board APIs that career-ops already speaks.

Seed list: `config/india-seed-companies.yml` — 149 companies across the four
buckets the PRD names (Indian product companies, AI-native startups, global
product companies hiring PMs in India, and GCCs with genuine product charters).

```bash
npm run seed:india          # preview what resolves
npm run seed:india:write    # append resolved tenants to portals.yml
npm run validate:portals && npm run verify:portals
npm run scan
```

GCCs are on the seed list **on purpose**. A strong GCC platform role can
outrank a weak startup role, so they are surfaced and *labelled* rather than
filtered out; the `company_type` rubric dimension discriminates per posting.

> **⚠️ Verification outstanding.** The seed list is committed but the ATS probe
> has not been run to completion: the environment this was built in blocks
> outbound HTTPS to ATS hosts (`boards-api.greenhouse.io` and friends return
> `403` at the egress proxy). `portals.yml` therefore ships with
> `tracked_companies: []` rather than with unverified tenant slugs — an
> unverified slug is worse than an absent one, because it fails silently at
> scan time and looks like "no jobs".
>
> **To complete:** run the three commands above on an unrestricted network. The
> PRD's "≥ 60 verified India-hiring tenants" criterion is met by
> `verify:portals` passing, not by the seed list's length.

---

## Tier 3 — Firecrawl for unindexed career pages ✅ (tightly scoped)

**Status: adopted, with a hard scope.** The genuine gap it fills: mid-size
Indian companies running custom or Zoho Recruit career portals that no
supported ATS covers.

Scope rules, all four of which must hold:

1. Only for companies **already on the seed list** — never open-ended crawling.
2. Only where `discover-ats.mjs` found **no ATS**.
3. `robots.txt` and terms checked **per domain**, with the decision recorded in
   the log below.
4. Cached aggressively; re-crawled **weekly at most**.

Output normalises to the same `Job` shape as any provider.

**Never point Firecrawl at Naukri or LinkedIn.** A managed crawler does not
change what the target site's terms permit — it only moves the request. This is
the single easiest way for this tier to turn into a violation, so it is written
down here as well as in `modes/_custom.md`.

---

## Tier 4 — Instahyre / Cutshort ⏸️

**Status: deferred, unverified.** Build only if Tiers 1–3 leave a *measured*
gap — measure first, then decide.

Instahyre reportedly exposes an unauthenticated JSON endpoint at
`/api/v1/job_search/`. That is **an unverified third-party claim originating
from a commercial scraper's marketing page**, which is close to the least
reliable kind of source available. It is recorded here so nobody re-discovers
the claim and treats it as fact.

Verification steps required *before* any code is written:

1. Open the listings page; devtools → Network → XHR.
2. Confirm the endpoint with bare `curl` — no cookies, no browser user-agent.
3. Record base URL, params, pagination, rate limits, response shape.
4. Check `robots.txt` and the terms of service.
5. Only then write `providers/instahyre.mjs`, following `providers/remotive.mjs`.

Provider requirements if it ever gets built: `// @ts-check` with the `Provider`
typedef; `{ redirect: 'error' }` on every fetch; defensive per-field validation
(upstream is untrusted); a descriptive throw on an unexpected shape; honour
`ctx.maxPages`; pace with `ctx.sleep`; and one unit test against a **recorded
fixture — no live network in tests**.

---

## LinkedIn and Naukri ⛔ — rejected for automation, kept for humans

**Status: permanently rejected as automated sources. This is not a
to-do.**

**Reason:** both prohibit automated access in their terms. LinkedIn enforces
actively, and the account at risk is the personal one the job search itself
depends on — the downside is losing the very tool you need most, not a slap on
the wrist. No scraper, no Firecrawl proxy, no headless session, no "just the
public pages".

**What they remain in the workflow for**, which the app already supports:

- **Browse as a normal user.** When something looks good, paste the JD or the
  URL into the pipeline — `modes/auto-pipeline.md` handles both, and
  `jd-capture.mjs` exists for exactly this.
- **Convert a sighting into permanent coverage.** When a listing points to a
  company not yet on the seed list:

  ```bash
  npm run add-company -- "Company Name"
  ```

  which appends it to the seed list and probes it for an ATS. One manual
  sighting permanently improves automated coverage — the highest-leverage habit
  in this whole design, and the reason keeping these surfaces manual costs far
  less than it looks.

  (`add-company.mjs` refuses a LinkedIn/Naukri/Indeed URL as a company name
  rather than guessing "Linkedin" as an employer. It never fetches those sites.)

- **Hiring signal, which is their real edge.** Not bulk listings: who just
  raised, who is building a PM function, who posted about a team they are
  growing. That is a human-judgement input, and no scraper produces it.

---

## Per-domain crawl decisions (Tier 3 log)

Append one row per domain before crawling it. An empty table means no
Firecrawl crawl has been authorised yet.

| Date | Domain | ATS detected? | robots.txt | Terms reviewed | Decision | Reason |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | *no crawls authorised yet* |

---

## Change log

| Date | Change |
|---|---|
| 2026-08-25 | Initial record. Tiers 1–3 adopted, Tier 4 deferred pending verification, LinkedIn/Naukri rejected for automation. Tier 2 seed list committed (149 companies); ATS probe outstanding — blocked by egress policy in the build environment, not by the design. |
