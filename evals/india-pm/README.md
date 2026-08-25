# India PM calibration set — 15 real JDs

The Part A acceptance set from PRD v2 §A1: *"15 real JDs evaluated, deliberately
spanning the range — GCC and product company, Indian startup and international
remote, and at least 5 from non-AI domains."*

Every case is a **real posting**, collected through the Indeed MCP connector on
2026-08-25 across Pune, Bengaluru, Hyderabad and remote. None are synthetic —
`"synthetic": false` on each — which is the point: constructed JDs are tidier
than real ones, and the failure modes this set exists to catch (a requisition-code
title, an 80-word boilerplate JD, a role whose title says AI and whose body does
not) do not occur in JDs someone wrote to make a point.

Each file stores the metadata, a hand label, and the **quoted evidence** for that
label — not the full JD text. The evidence is what makes a label reviewable, and
an unreviewable label is how a wrong one survives a calibration pass. Follow the
`url` for the posting itself.

---

## The four acceptance criteria, and where each is checked

| Criterion | Status | Where |
|---|---|---|
| Zero product-marketing roles reaching evaluation | **Automated** | `tests/india-pm-calibration.test.mjs` |
| The set spans the required range | **Automated** | same file |
| GCC/product classification correct on ≥ 90% | **Manual** — needs an evaluation run | below |
| ≥ 1 strong non-AI role scores ≥ 4 | **Manual** — needs `cv.md` | below |

The first two are deterministic and run in the normal suite. The last two are
not, and are honestly marked so rather than faked:

**Why there are no `score` labels.** A fit score is a score *for a particular
candidate*. It cannot be derived from the JD alone, and `cv.md` is the one input
no template can supply. Inventing reference scores would produce a calibration
set that agrees with itself and measures nothing — the specific failure the "≥ 1
non-AI role ≥ 4" criterion exists to detect. So the labels record what is
knowable from the posting (company type, domain, seniority, roadmap authority,
AI shape) and stop there.

---

## Running the manual half

Once `cv.md` exists and `node doctor.mjs` is clean:

```bash
# Evaluate each case's URL through the normal pipeline
node india-scan.mjs --stdin < <(...)     # or paste each URL into data/pipeline.md
# then: /career-ops pipeline
```

Then check two things.

### 1. GCC classification — target ≥ 90% (≥ 14 of 15)

For each report, compare its Machine Summary `company_type` against `label.company_type`
here. Record misses with the evidence the evaluation used, because a miss is
usually a rubric-wording problem rather than a one-off.

Three cases carry most of the signal:

- **`nielsen-gracenote-data-platform-lead-pm-bengaluru`** — every surface signal
  says capability centre ("from our Bengaluru engineering center", stakeholders
  in the US and Europe) and the JD rebuts it outright: *"This is not a satellite
  role. It is that the product anchor for our engineering center."* A classifier
  pattern-matching on "engineering center in India" labels this `gcc` and is
  wrong. **Expected: `product`.**
- **`cornerstone-workforce-ai-pm-hyderabad`** — a product company whose India
  seat is described in capability-centre terms ("connective tissue between global
  product strategy and day-to-day engineering execution", reports to Strategic
  Programs). The evidence genuinely points both ways. **Expected: `unclear`** —
  resolving it by defaulting to the company's type is the failure.
- **`te-connectivity-pm3-pune`** — an 80-word JD with no roadmap language, no
  reporting line, no stakeholders. **Expected: `unclear`.** Guessing here is the
  thing §A1.3 forbids: *"Never guess this one silently."*

A run that scores 15/15 by labelling everything `gcc` or everything `product`
has not passed — check the distribution, not just the count.

### 2. At least one strong non-AI role scores ≥ 4

Ten of the fifteen cases are non-AI. The four to watch:

| Case | Domain | Why it should score well |
|---|---|---|
| `jfrog-platform-access-pm-bengaluru` | platform / IAM | Primary domain, senior level, explicit strategy ownership |
| `qad-senior-pm-pune` | ERP / supply chain | 8-12 years, roadmap ownership, SCM experience named as a plus |
| `freshworks-staff-pm-itsm-hyderabad` | enterprise B2B SaaS | 9+ years, owns multi-year strategy, Indian product company |
| `nielsen-gracenote-data-platform-lead-pm-bengaluru` | data platform | 8+ years, owns vision and roadmap |

**If none of these clears 4 while the AI roles do, the rubric is covertly narrow
and needs rebalancing.** That is the real test in this set — the PRD calls it out
because the failure is invisible: a narrow rubric produces confident, plausible,
consistently-too-low scores on exactly the lanes where this candidate is rarest.

Note that two AI-titled cases should score *low* for reasons unrelated to AI:
`onelab-ai-pm-pune` (1-3 years, plus a hard institutional eligibility gate) and
`pwc-ai-product-manager-gcc-advisory-bengaluru` (consultancy, client owns the
product). If those score well, the rubric is rewarding AI keywords over fit.

---

## The AI builder-vs-steward spread

Three AI roles, three different readings — the dimension is only meaningful if
they come out different:

| Case | Expected | Why |
|---|---|---|
| `netomi-integrations-platform-pm-remote` | `builder` | Evaluation and quality gating, guardrails, tool-call reliability, latency and load behaviour |
| `google-feedback-platform-pm-hyderabad` | `steward` | Title says AI and agentic; the body is an ingestion-platform and developer-experience role |
| `pwc-ai-product-manager-gcc-advisory-bengaluru` | `keyword_only` | "AI Product Management" in the required skills, no eval, model-selection or cost/latency language anywhere |

---

## Two controls worth keeping

- **`nike-product-supply-chain-manager-bengaluru`** is a false-positive control.
  Its title contains both "Product" and "Manager" but never the phrase "Product
  Manager", the career area is Manufacturing & Engineering, and the work is
  factory-partner program management. `expect_title_filter: "reject"`. It was
  returned by a genuine supply-chain PM search, which is exactly why a
  hand-written test list would not have contained it.
- **`netomi-…`** and **`trellix-…`** are located simply `Remote`, with no
  country. They normalize to `market: unknown` — the bucket §B7 requires to be
  surfaced rather than dropped, exercised here by real data rather than by a
  fixture.

---

## Adding a case

Same shape as the existing files. `expect_title_filter` must be `"pass"` or
`"reject"`, and `label.company_type_evidence` must quote the posting — the test
enforces both. Then re-run:

```bash
node test-all.mjs --only india-pm-calibration
```
