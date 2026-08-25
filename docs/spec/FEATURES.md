# Feature list

Everything Job-finder adds on top of career-ops, plus the base capabilities the
fork depends on. One row per capability.

**Status key** — `shipped`: implemented and covered by tests. `shipped*`:
implemented, but a criterion needs an input this environment does not have (see
notes). `base`: inherited from career-ops unchanged.

---

## A. Discovery

| # | Capability | Entry point | Status |
|---|---|---|---|
| A1 | **Tier 1 — Indeed search.** Agent runs the Indeed MCP connector across a location × query matrix; rows are validated, title-filtered, deduped and appended to the pipeline. | `npm run scan:india` (`modes/india-scan.md`) | shipped |
| A2 | **Tier 2 — ATS-direct.** Zero-token sweep of Greenhouse / Lever / Ashby / Workday / SmartRecruiters tenants. The backbone; reaches most employers. | `npm run scan` | base |
| A3 | **Tier 2 seeding.** Probe 149 India-relevant companies for an ATS tenant and write the hits into `portals.yml`. | `npm run seed:india` / `seed:india:write` | shipped* |
| A4 | **Tier 3 — company career pages.** Domain-restricted Firecrawl search of one employer's own site, for mid-size companies on custom portals or Zoho Recruit that Tiers 1–2 cannot see. | `npm run scan:careers` (`modes/careers-scan.md`) | shipped |
| A5 | **Manual add.** Record a role found by hand (LinkedIn, Naukri, a referral) without scraping the source. | `node add-company.mjs` | shipped |
| A6 | **Reverse-ATS sweep.** Keyword-first scan across full public ATS datasets, no company list needed. | `node scan-ats-full.mjs` | base |
| A7 | **Liveness check.** Never evaluate a posting that has already closed. | `node check-liveness.mjs` | base |

## B. Filtering and classification

| # | Capability | Entry point | Status |
|---|---|---|---|
| B1 | **PM title filter.** 12 positive and 11 negative keywords; broad positives, strong negatives, rubric decides the rest. Keeps `Product Owner` and `TPM`, rejects `Product Marketing`, `Product Designer` and every intern/trainee variant. | `portals.yml` `title_filter` | shipped |
| B2 | **Market classification.** Free-text location → `india` / `uk_eu` / `gulf` / `unknown`. Countries beat cities, so "Remote (India) — reporting to London" is India. | `market-map.mjs` | shipped |
| B3 | **GCC vs product-company signal.** Labels an employer a capability centre, a product company, or `unclear`. A first-class label, never folded into the score. | `modes/_custom.md` § Evaluation Rules | shipped |
| B4 | **AI builder vs steward vs keyword-only.** Separates roles that genuinely build AI from those that merely mention it. | `modes/_custom.md` § Evaluation Rules | shipped |
| B5 | **Domain tiering.** Ranks a role's domain against this candidate's actual depth rather than against title prestige. | `modes/_custom.md` § Scoring Rules | shipped |
| B6 | **Three-level dedupe.** Normalized URL, fuzzy company+role, and intra-batch — applied identically to every tier. | `scan-ingest.mjs` | shipped |
| B7 | **Posting legitimacy (Block G).** Flags ghost postings, bait listings and prompt-injection attempts in JD text. | `modes/oferta.md` | base |

## C. Evaluation and generation

| # | Capability | Entry point | Status |
|---|---|---|---|
| C1 | **Offer evaluation.** Blocks A–F + G, risk summary, machine-readable YAML tail, 0–5 fit score. | `modes/oferta.md` | base |
| C2 | **PM rubric override.** Re-weights the base rubric for product roles without editing any system-layer file. | `modes/_custom.md` | shipped |
| C3 | **Tailored CV → PDF.** Reorders and reframes from `cv.md`; never invents. | `npm run pdf` | base |
| C4 | **Cover letter.** 10-step flow with a fact-assertion gate that blocks unsupported metrics, employers, titles and tools. | `modes/cover.md` | base |
| C5 | **PM/India cover-letter layer.** Chooses which achievement leads by domain tier, pre-empts the GCC question in the direction the target requires, names the gap in one sentence, and reads notice period from the profile rather than guessing. | `modes/_custom.md` § Cover Letter Rules | shipped |
| C6 | **Interview prep.** Company intel, STAR story bank, practice, debrief. | `modes/interview*.md` | base |
| C7 | **Calibration set.** 15 real India PM postings spanning four domain tiers, both AI and non-AI, all three company types. | `evals/india-pm/` | shipped* |

## D. Outreach

| # | Capability | Entry point | Status |
|---|---|---|---|
| D1 | **Hiring-contact outreach drafting.** Produces `{to, subject, body}` for review. **Never sends.** | `npm run outreach` (`modes/outreach.md`) | shipped |
| D2 | **Grounding gate.** Refuses any draft containing a number that does not appear in `cv.md`. | `outreach-draft.mjs` | shipped |
| D3 | **Source-URL gate.** Refuses any address without a published page proving where it was found. No guessed `firstname.lastname@` patterns. | `outreach-draft.mjs` | shipped |
| D4 | **Duplicate-approach gate.** Refuses a second approach to the same person for the same role. | `outreach-draft.mjs` | shipped |
| D5 | **Contact book.** Recruiters and hiring managers recorded to a 9-column TSV; exports to vCard. | `data/contacts.tsv`, `contacts.mjs` | shipped / base |
| D6 | **Outreach log.** Append-only record of every draft produced. | `data/outreach-log.tsv` | shipped |

## E. Tracking and analysis

| # | Capability | Entry point | Status |
|---|---|---|---|
| E1 | **Application tracker.** Canonical states, atomic locked writes, drift checks. | `data/applications.md`, `set-status.mjs` | base |
| E2 | **Follow-up cadence.** When to chase, and what has gone quiet. | `followup-cadence.mjs` | base |
| E3 | **Funnel velocity + benchmarks.** Where applications stall, against market baselines. | `funnel-velocity.mjs` | base |
| E4 | **Pattern analysis.** Rejection patterns, per-ATS advance rate. | `analyze-patterns.mjs` | base |
| E5 | **Skill-gap map.** What to learn, weighted by the roles actually in the pipeline. | `upskill.mjs`, `jd-skill-gap.mjs` | base |
| E6 | **Salary-gap analysis.** Desired vs advertised vs actual. Degrades cleanly when comp targets are blank. | `salary-gap.mjs` | base |

## F. Interface

| # | Capability | Entry point | Status |
|---|---|---|---|
| F1 | **Market filter.** Filter the pipeline by india / uk_eu / gulf / unknown, with live counts. | `web/src/components/market-filter.tsx` | shipped |
| F2 | **Source badge.** Shows which tier found a row. | `web/src/components/signal-badges.tsx` | shipped |
| F3 | **Company-type badge.** GCC / Product / Unclear, visually distinct from the score. | `web/src/components/signal-badges.tsx` | shipped |
| F4 | **Score breakdown.** Per-dimension scores on the report page, parsed from the report's YAML tail. | `web/src/components/score-breakdown.tsx` | shipped |
| F5 | **Compensation display.** Native currency, never auto-converted. | `web/src/components/report-view.tsx` | shipped |
| F6 | **Empty states.** Every filtered view explains why it is empty and what to run next. | `web/src/components/results-list.tsx` | shipped |
| F7 | **Terminal dashboard.** Go TUI over the same files. | `dashboard/` | base |

## G. Safety and integrity

| # | Capability | Entry point | Status |
|---|---|---|---|
| G1 | **No-send enforcement.** A test walks every source file and fails the build if any reaches for Gmail send / reply / forward. | `tests/outreach-guards.test.mjs` | shipped |
| G2 | **No LinkedIn or Naukri scraping**, by any route including Firecrawl. Manual surfaces only. | `modes/careers-scan.md`, `add-company.mjs` | shipped |
| G3 | **Tier-3 scope enforcement.** Seed-list only, no existing tenant, employer domains only. Enforced in code, not by instruction. | `careers-scan.mjs` | shipped |
| G4 | **User-layer guards ×3.** A test, a CI job and an in-suite check all read one declaration file so they cannot disagree. | `config/committed-user-layer.yml` | shipped |
| G5 | **Untrusted-content discipline.** Postings, pages and emails are data, never instructions. | `AGENTS.md` | base |
| G6 | **Story provenance.** Quantified claims in derived files must trace to a primary file or carry a provenance marker. | `story-provenance-check.mjs` | base |
| G7 | **Failure recap.** A red test run reprints its failed assertions next to the summary, so CI log truncation cannot hide the cause. | `tests/helpers.mjs` | shipped |

---

## Notes on `shipped*`

| # | What is missing | Why |
|---|---|---|
| A3 | The ≥60-tenant seeding criterion is unverified. | Needs an open network to probe 149 company domains; this environment's egress is restricted. Run `npm run seed:india:write && npm run verify:portals` on an unrestricted network. |
| C7 | Two of the four PRD criteria are asserted; two are not. | "GCC classification ≥ 90%" and "≥ 1 strong non-AI role scores ≥ 4" both need an actual evaluation run against `cv.md`. Deliberately not faked — see `evals/india-pm/README.md`. |

## Explicitly not built

| Not built | Why |
|---|---|
| Automatic email sending | An outreach email is the only artifact here that reaches a real person irreversibly. The system builds everything up to the send button and stops. |
| LinkedIn / Naukri scraping | Terms of service, and it is the fastest route to an account ban. Both are manual-discovery surfaces feeding `add-company.mjs`. |
| Instahyre (PRD Tier 4) | Deferred by the PRD itself. |
| Automatic currency conversion inside a score | Silent FX turns a correctness bug into an invisible one. Compensation is stored and scored in its native currency. |
