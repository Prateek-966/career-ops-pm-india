# Job-finder — PM Edition + India coverage

This is a fork of [santifer/career-ops](https://github.com/santifer/career-ops)
(MIT) re-shaped for a **Product Manager job search in India**, per PRD v2.

Upstream's `README.md` still describes the base system and is unchanged. This
file describes only what this fork adds, and how to start it.

**Specifications.** [`docs/spec/`](docs/spec/) carries the full set — a
[feature list](docs/spec/FEATURES.md), a [functional spec](docs/spec/FUNCTIONAL.md),
a [technical spec](docs/spec/TECHNICAL.md) and the
[fork architecture](docs/spec/ARCHITECTURE.md). Read this file to *use* the
fork; read those to understand or extend it.

---

## Start here

```bash
npm install --ignore-scripts   # postinstall fetches Chromium; skip if you have it
npm run setup:pm-india         # installs the PM/India config into the user layer
node doctor.mjs                # tells you what is still missing
```

`setup:pm-india` copies five committed templates into the paths the CLI reads.
It never overwrites an existing file without `--force` (which keeps a `.bak`).

| Template (committed) | Installed to |
|---|---|
| `templates/profile.pm-india.example.yml` | `config/profile.yml` |
| `templates/portals.pm-india.yml` | `portals.yml` |
| `modes/_custom.pm-india.template.md` | `modes/_custom.md` |
| `templates/india-seed-companies.yml` | `config/india-seed-companies.yml` |
| `templates/story-bank-pm-template.md` | `interview-prep/story-bank.md` |

**Why the split.** Those destinations hold a real person's targeting, comp
expectations and contact details, so upstream gitignores them and
`tests/user-layer-gitignored` fails the build if any becomes committable. That
guard is correct and this fork keeps it — but a gitignored file does not survive
a fresh clone, and the archetype ladder, the title filter and the rubric are
work that has to. So the work lives in `templates/` and the personal copy lives
where git cannot see it.

**Two exceptions, declared not smuggled.** `cv.md` and `config/profile.yml` ARE
committed here, because without them a fresh clone cannot generate anything at
all. Both are listed in [`config/committed-user-layer.yml`](config/committed-user-layer.yml)
with a reason, all three guards read that one file so they cannot disagree, and
the guard reports each as a warning naming the reason on every run rather than
passing silently. **This repository is public**, so the values that could not
survive publication — `compensation.target_range`, `compensation.minimum` and
the phone number — are blank, and were removed from every commit in this
branch's history. Fill them in locally; do not commit them.

Then supply the two things no template can:

1. **`cv.md`** — your CV as markdown. Required; `doctor.mjs` reports it.
2. **The `candidate:` block** in `config/profile.yml` — name, phone, LinkedIn.
   It ships with `TODO` placeholders on purpose rather than invented values.

---

## What this fork changes

### Part A — shaped for PM roles

The engine was already role-agnostic, so this is configuration and rubric work.

- **Broad positives, strong negatives, rubric decides.** `portals.yml` admits
  the full PM surface and rejects only genuine non-PM roles. Title filtering is
  cheap and runs at scan time; evaluation is expensive and runs per posting.
  No domain keywords in the positive list — a "Senior Product Manager" title at
  a supply chain company carries no domain word at all, and a domain-gated
  filter drops it in silence. `tests/pm-title-filter.test.mjs` freezes both
  halves of that: nothing product-marketing gets through, and nothing PM-shaped
  is lost.
- **`modes/_custom.md`** adds the PM dimensions (roadmap authority, product
  surface, AI builder-vs-steward, domain fit, transferability, org shape) as an
  *additive* override. `modes/oferta.md` is untouched, so an upstream update
  stays a no-op.
- **The GCC signal** — the highest-value distinction in the Indian market. An
  identically-titled PM role at a global capability centre and at a product
  company are different jobs with different ceilings. It is recorded as a
  **label, never a penalty** (a strong GCC platform role can outrank a weak
  startup role), it is excluded from the score arithmetic, and an ambiguous case
  is labelled `unclear` and flagged rather than guessed.

### Part B — India coverage, by legitimacy rather than scraping breadth

> Aggregators are indexes. The ATS is the source of truth.

| Tier | What | Command |
|---|---|---|
| 1 | Indeed, official MCP connector | `modes/india-scan.md` → `npm run scan:india` |
| 2 | ATS-direct — **the backbone** | `npm run seed:india:write` |
| 3 | Company career pages with no ATS | `modes/careers-scan.md` → `npm run scan:careers` |
| — | LinkedIn / Naukri | **manual only**, `npm run add-company` |

`india-scan.mjs` reuses `scan.mjs`'s own dedupe and append machinery rather than
a parallel engine, so an Indeed row is deduped against the same history under
the same lock as a Greenhouse row — a role already in the pipeline from the ATS
tier is not re-added because Indeed also indexes it.

**LinkedIn and Naukri are never scraped**, by any route including Firecrawl.
Both prohibit automated access, LinkedIn enforces it, and the account at risk is
the one the job search itself depends on. They stay manual discovery surfaces,
and `npm run add-company -- "Company Name"` is the one command that converts a
sighting there into permanent automated coverage.

Every source investigated, adopted or rejected, is recorded in
[`docs/india-sources.md`](docs/india-sources.md) — including the rejections and
why, so nobody re-investigates them next quarter at the same cost.

### Part C — UI

Extends the existing Tailwind/`cva` primitives; no second visual identity.
Market filter on `/pipeline` and `/explore` with a visible `Unknown market`
bucket, neutral source badges, a GCC/Product/**Unclear** badge where `Unclear`
is deliberately distinct, and a dimensional score breakdown on the report view
so the score is inspectable rather than taken on faith.

---

## Commands this fork adds

| Command | What it does |
|---|---|
| `npm run setup:pm-india` | Install the PM/India config into the user layer |
| `npm run scan:india` | Filter + dedupe + append Indeed MCP results (Tier 1) |
| `npm run seed:india` | Preview which seed companies resolve to an ATS |
| `npm run seed:india:write` | Append resolved tenants to `portals.yml` (Tier 2) |
| `npm run scan:careers` | Career pages with no ATS (Tier 3); `-- --list-targets` first |
| `npm run add-company -- "Name"` | Seed a company and probe it for an ATS |
| `npm run outreach` | Validate + record an outreach email — **never sends** |
| `npm run cover-letter -- payload.json` | Render a cover letter to PDF (upstream) |

## Cover letters

Already built upstream — `modes/cover.md` runs a 10-step flow with a JD gate,
company research, gap detection and achievement selection from `cv.md` only,
and `generate-cover-letter.mjs` renders it to PDF.

Its fact gate is `assertFacts` from `verify-cv-facts.mjs`, and it is stricter
than the outreach one: it blocks invented metrics **and** unsupported employers,
titles and tools. Verified against the real CV — a letter claiming *"92% faster
for 50,000 users… using Kubernetes"* is blocked on all three counts, while the
same sentence with the CV's real figures passes.

What this fork adds is `modes/_custom.md` → **Cover Letter Rules**, which
`cover.md` honours via `_shared.md`:

- **Which achievement leads**, chosen by the role's domain tier rather than by
  whichever is most impressive in isolation. One achievement developed, not
  three listed — they already have the CV.
- **The GCC question, pre-empted.** This candidate works *at* a GCC, which cuts
  both ways. Writing to a product company, the unspoken question is *"have you
  actually owned a roadmap?"* — answered with CTO/CIO approval and the funding
  cases, not by hiding the background. Writing to a GCC, knowing the operating
  model first-hand is a real advantage most applicants lack. `unclear` asks
  rather than guesses.
- **Name the gap** in one sentence, before the reader finds it themselves.
- **India specifics** — notice period read from the profile and never guessed,
  never a compensation figure in prose, and `cv.md`'s own currencies kept.

## Outreach

`modes/outreach.md` turns a tracked role into a specific email to a specific
person, saved as a **Gmail draft** you review and send yourself.

It refuses to produce a draft — writing nothing — when `cv.md` is missing, when
a number in the body does not appear in `cv.md`, when the contact's address has
no `source_url` pointing at a page where the company published it, when there is
no named addressee, or when that person has already been approached for that
role. Those refusals are the feature: an outreach email is the only thing this
system produces that reaches a real person, under your name, irreversibly.

`tests/outreach-guards.test.mjs` fails the build if any code path reaches for
Gmail's send, reply or forward. Creating a draft is compatible with the core
`modes/email.md` rule — *"Never submit. Never send email. Never click send."* —
and sending is not.

Everything upstream still works unchanged: `npm run scan`, `node doctor.mjs`,
`npm run validate:portals`, `node test-all.mjs`, and the web UI in `web/`.

---

## Licence and naming

Upstream is MIT and its `LICENSE` is retained. Upstream's `TRADEMARK.md` means a
derived product cannot be *called* career-ops — irrelevant while this stays a
local single-user tool, relevant the moment anything ships.
