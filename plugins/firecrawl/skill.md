# Firecrawl provider — how to drive it

Tier 3 of the discovery model: company career pages that no supported ATS
covers. Mid-size employers on custom portals or Zoho Recruit are invisible to
Tiers 1 and 2, and some of them are exactly the enterprise-B2B and supply-chain
employers this search targets.

## Setup

1. Get an API key from https://firecrawl.dev (billed per search).
2. Enable the plugin in `config/plugins.yml`.
3. Put `FIRECRAWL_API_KEY=fc-...` in `.env` — or, for a hosted instance, in the
   host's environment variables.

## portals.yml entry

Fires only on an explicit `provider: firecrawl` entry. Never auto-detects.

```yaml
tracked_companies:
  - name: "Zoho — Product Manager"
    provider: firecrawl
    company: "Zoho"                    # the employer, used verbatim
    query: "product manager"
    include_domains: ["zoho.com"]      # REQUIRED — the scope
    limit: 20                          # optional, default 20, max 100
    location: "Chennai, India"         # optional, recorded on each row
```

| Key | Required | Meaning |
|---|---|---|
| `provider` | yes | must be `firecrawl` |
| `query` | yes | what to search for on that site |
| `include_domains` | yes | employer hostnames the search is confined to |
| `company` | no | employer name; falls back to `name` |
| `limit` | no | results per search, 1–100, default 20 |
| `location` | no | recorded on each row (search results carry no structured location) |
| `location_hint` | no | passed to Firecrawl to bias results geographically |
| `timeout_ms` | no | per-search timeout, default 60000 |

## Three refusals, and what each means

These are enforced in code, not left to this document.

**No `include_domains` → refused.** An unscoped search is a sweep of the open
web. That is not Tier 3, and it spends your credits on results that will be
thrown away.

**`include_domains` naming an aggregator or ATS → refused.** You cannot point
this at `linkedin.com` or `naukri.com`. Scraping those is forbidden by
`AGENTS.md` by any route, and "via Firecrawl" is still that route. Use their
own job-alert emails instead — that is a supported feature and carries no
account risk.

**An individual result on an ATS host → skipped.** A hit on
`boards.greenhouse.io` means Tier 2's probe missed that tenant. The fix is to
seed the tenant so Tier 2 owns the company properly — cheaper, zero-token, and
more complete than re-finding it through search every week. Ingesting it here
would hide the coverage gap instead of exposing it.

## Cost

Every search spends Firecrawl credits, so this tier is not free the way the ATS
sweep is. Point it at companies Tier 2 genuinely cannot see; running it against
a company that already has an ATS tenant is money spent to get a worse version
of data you already have.
