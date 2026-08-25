# Architecture — the Job-finder fork

Why the fork is shaped the way it is. The base system's architecture is
documented in [`ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md); this describes only what sits on
top, and the decisions behind it.

---

## 1. The layer that surprises people

Job-finder has an **agent layer** and a **script layer**, and most of its
behaviour lives in the agent layer.

```
┌─────────────────────────────────────────────────────────────┐
│  AGENT LAYER — modes/*.md                                   │
│  Markdown instructions an AI CLI reads and follows.         │
│  Judgement, prose, classification, tool orchestration.      │
├─────────────────────────────────────────────────────────────┤
│  SCRIPT LAYER — *.mjs                                       │
│  Deterministic Node. Validation, dedupe, locking, IO.       │
│  Zero LLM. Testable. Same answer every time.                │
├─────────────────────────────────────────────────────────────┤
│  DATA LAYER — data/, reports/, *.yml, cv.md                 │
│  Plain files. Canonical. Human-readable and diffable.       │
└─────────────────────────────────────────────────────────────┘
```

The dividing line is **whether the answer is deterministic**. Deduping two
postings is; deciding whether a role is a capability-centre seat is not. Work
that can be settled by rules lives in a script and is frozen by a test. Work
requiring judgement lives in a mode and is constrained by rules the scripts
enforce at the boundary.

This is why "where is the server?" has no answer. There isn't one. Nothing runs
unless an agent or a human runs it.

---

## 2. Why connectors integrate at the agent layer

Upstream has a `providers/` directory: one module per job board, each fetching a
keyed HTTP API. The obvious move for Indeed was `providers/indeed.mjs`.

It doesn't work, for a structural reason. **The Indeed connector is an MCP tool,
not a public keyed API.** There is no URL a provider module could fetch. The
only ways to reach it are (a) from an agent that has the tool, or (b) by
re-implementing it as a scraper — which is precisely the mistake Tier 1 exists
to avoid.

So the integration inverts. The agent runs `modes/india-scan.md`, calls the
connector across the location × query matrix, and pipes the collected rows into
`india-scan.mjs`. The script never touches the network. The same applies to
Tier 3 and Firecrawl.

**The consequence worth internalising:** the scripts are pure functions over
already-fetched data. That is why they are fast, testable, and safe to run
repeatedly — and why the tier files are so thin.

---

## 3. Why one ingest core, not two

Tiers 1 and 3 both ingest rows. The first version had each doing its own
validation, filtering and dedupe.

That is the classic silent-rot shape. Two copies of dedupe do not fail loudly
when they diverge — one tier simply starts re-adding roles the other already
recorded, nothing errors, and the inbox gets slightly less trustworthy every
week until nobody trusts it and nobody can say when that started.

`scan-ingest.mjs` holds the single copy. A tier module may supply only two
things: **how rows are obtained**, and **what source tier they carry**. Any
filtering logic appearing in a tier module is a bug, not a variation.

That core in turn defers to `scan.mjs`'s own history and locking primitives, so
an Indeed-sourced row is deduped against the same history, under the same lock,
by the same rules as a Greenhouse-sourced one. There is exactly one dedupe in
the system.

---

## 4. Why scope is structural, not documented

Tier 3 is the only component that touches an arbitrary company's website, and
"documented scope" is scope that erodes. Two things make it structural instead:

**The tool has no crawler.** Firecrawl here exposes *search* with
`includeDomains`, not a crawl. A sweep is a domain-restricted search of one
company's own site. There is no open-ended crawling available to accidentally
do — not because we chose not to, but because the capability is absent.

**The rules are code.** `scopeViolation()` enforces seed-list membership,
absence of an existing tenant, and employer-domain-only, returning a reason
string. The mode file *describes* these rules; it is not trusted to follow them.

The third rule has a subtlety worth keeping. An ATS-hosted hit is **refused**,
not ingested — because its existence means Tier 2's probe missed a tenant. The
correct response is to seed that tenant so Tier 2 owns the company properly, not
to launder the posting through Tier 3 and leave the gap in place. Refusing turns
a silent coverage hole into a visible one.

---

## 5. Why outreach stops at the send button

This was a deliberate narrowing of the original request, and it is the most
consequential decision in the fork.

An outreach email is **the only artifact in this system that reaches a real
person, under the candidate's name, irreversibly.** A bad CV can be regenerated.
A bad evaluation can be re-run. A sent email cannot be unsent, and the damage
lands on a named human being's professional reputation in the exact market they
are trying to enter.

So the system builds everything up to the send button: identifies the contact,
composes the message, validates it, records it, and returns `{to, subject,
body}`. A human presses send.

Four gates, all refusing rather than warning, all without an override flag:

| Gate | The failure it prevents |
|---|---|
| `cv.md` must exist | Without ground truth, "why you should hire me" is invention aimed at a hiring manager |
| Every number must trace to `cv.md` | An untraceable figure may have been fabricated, and the reader cannot tell |
| The address needs a `source_url` | Guessed `firstname.lastname@` patterns bounce, wreck sending reputation, and are how outreach becomes spam |
| No repeat approach to the same person for the same role | A second approach is not persistence |

`tests/outreach-guards.test.mjs` walks every source file and fails the build if
any reaches for Gmail send, reply or forward. The rule is enforced by CI, not by
memory.

---

## 6. Why GCC is a label, not a score input

The GCC-versus-product-company distinction is the single most load-bearing
signal in an India PM search, and the instinct is to score it.

That would be wrong, for two reasons. First, it is genuinely ambiguous in a
large fraction of cases — a product company describing its India seat in
capability-centre language, or a capability centre that owns real global
product. A number implies a confidence the evidence does not support. Second,
the direction is not fixed: this candidate *works at* a GCC, which is a
liability writing to a product company and an asset writing to another GCC.

So it is a label carried alongside the score, with `unclear` as a first-class
value rather than a fallback. The UI renders it visually distinct from the score
for exactly this reason — a label must never be mistaken for a judgement.

The same reasoning produces the rule that compensation is never auto-converted
inside a score. Silent FX takes a correctness problem and makes it invisible.

---

## 7. Why `modes/_custom.md` carries the personalisation

Every rubric change, every house rule, every cover-letter instruction in this
fork lives in one user-layer file that `_shared.md` instructs all modes to read.

Nothing in `modes/` proper was edited. The alternative — editing `_shared.md` or
`oferta.md` directly — works exactly once, and then every upstream update either
clobbers the customisation or conflicts with it, and the fork slowly stops being
able to take updates at all.

Because the personalisation sits in the extension point instead, `update-system.mjs`
can replace the entire system layer and the PM rubric survives untouched. **An
upstream update is a no-op against this fork's targeting.**

---

## 8. Why `web/` mirrors two files

Turbopack pins the project root at `web/`, so `web/` cannot import from the repo
root. Market classification is needed in both places.

The options were: duplicate, build-step, or monorepo restructure. Duplication
won because the alternatives cost more than the problem — but duplication
without a guard is just a future divergence. `tests/market-map-parity.test.mjs`
fails the build if the copies differ.

The mirror is a deliberate, tested exception. It is not a licence to add another
without the same guard.

---

## 9. Data flow

```
   Indeed MCP ─┐
               ├─→ scan-ingest.mjs ──→ data/pipeline.md ──→ evaluation
   Firecrawl ──┘         │                                     (modes/oferta.md
                         │                                      + modes/_custom.md)
   ATS sweep ────────────┤                                          │
   (scan.mjs)            │                                          ▼
                         │                                    reports/{n}-{co}.md
   Manual ───────────────┘                                          │
   (add-company.mjs)                                                ▼
                                    ┌──────────────────────┬────────┴─────────┐
                                    ▼                      ▼                  ▼
                              tailored CV            cover letter         outreach
                              (PDF/LaTeX)            (assertFacts)     (4 gates, draft)
                                    │                      │                  │
                                    └──────────┬───────────┴──────────────────┘
                                               ▼
                                     data/applications.md
                                     data/status-log.tsv
                                               │
                                    ┌──────────┴──────────┐
                                    ▼                     ▼
                              web/ (Next.js)       dashboard/ (Go TUI)
```

Every arrow into the tracker goes through the locked, validated write path.
Every arrow out is a derived read — no view holds state of its own.

---

## 10. Decisions record

| Decision | Alternative rejected | Because |
|---|---|---|
| Connectors at the agent layer | `providers/indeed.mjs` | No keyed HTTP API exists behind an MCP tool; the alternative is scraping |
| One shared ingest core | Per-tier ingest | Duplicate dedupe rots silently, never loudly |
| Tier 3 scope in code | Scope in the mode file | Documented scope erodes; enforced scope does not |
| Refuse ATS hits in Tier 3 | Ingest them | Refusing exposes a Tier 2 coverage gap instead of hiding it |
| Draft-only outreach | Auto-send | A sent email cannot be unsent, and it lands on a real person |
| GCC as label | GCC as score input | Often genuinely ambiguous, and the sign flips with the target |
| Native currency only | Auto-convert | Silent FX makes a correctness bug invisible |
| Personalisation in `_custom.md` | Edit `_shared.md` | Preserves the ability to take upstream updates forever |
| Mirror + parity test | Build step or monorepo | Cheapest option that cannot silently diverge |
| Broad positives, strong negatives | Precise positives | A false negative in discovery is invisible and permanent; a false positive costs one evaluation |
