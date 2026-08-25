# Technical specification

Module contracts, data formats and invariants for the Job-finder fork. Behaviour
is in [FUNCTIONAL.md](FUNCTIONAL.md); rationale is in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Stack

| Concern | Choice |
|---|---|
| Scripts | Node.js ESM (`.mjs`), no framework, no transpile |
| Config | YAML (`js-yaml`) |
| Data | Markdown tables and TSV — human-readable and diffable |
| Web | Next.js + React + TypeScript in `web/` |
| Terminal UI | Go, in `dashboard/` |
| Browser work | Playwright (PDF render, liveness checks) |
| Tests | `node:test` plus a hand-rolled assertion harness; no framework by design |

Node ≥ 22 for `web/`; the root suite runs under Node 24 in CI and is lint-checked
under Node 18 for syntax compatibility.

---

## 2. Module contracts

### 2.1 `market-map.mjs`

```js
export const MARKET_IDS = ['india', 'uk_eu', 'gulf'];
export const UNKNOWN_MARKET = 'unknown';
export function marketOf(location: string): string
export function marketLabel(id: string): string
export function locationTokens(value: string): string[]
```

Free-text location → market id. Implementation notes that matter:

- **`COUNTRY_PHRASES` is consulted before `CITY_PHRASES`.** Reversing this makes
  "Remote (India) — reporting to London" classify as UK.
- Phrase matching beats token matching, so multi-word place names are not split.
- Accents are folded before comparison.
- Anything unrecognised returns `UNKNOWN_MARKET`, never a guess.

**Mirrored** at `web/src/lib/market-map.mjs` — see §5.

### 2.2 `scan-ingest.mjs`

The shared ingest core. Tiers 1 and 3 are thin wrappers over it, so dedupe
cannot drift between them.

```js
export const SOURCE_TIERS = ['indeed', 'ats', 'firecrawl', 'manual'];
export const PORTALS_PATH = 'portals.yml';
export function normalizeRow(raw): {ok, offer} | {ok: false, reason}
export function extractRows(parsed): object[]
export function filterAndDedupe(offers, matchesTitle, snapshot): {kept, rejected}
export function tagOffer(offer, sourceTier, idLabel): object
export function ingest(parsed, matchesTitle, snapshot, {sourceTier, idLabel}): object
export function loadTitleFilter(portalsPath?): (title: string) => boolean
export function localToday(): string
```

Invariants:

- `normalizeRow` is defensive **per field**, not per object. A row missing a
  location is repaired; a row missing a URL is rejected with a reason. One bad
  row never costs the batch.
- `filterAndDedupe` applies all three dedupe levels. It defers to `scan.mjs`'s
  `loadDedupSnapshot` / `appendToPipeline` / `appendToScanHistory`, so an
  Indeed row is deduped against the same history, under the same lock, by the
  same rules as a Greenhouse row.
- A tier wrapper may only supply *how rows are obtained* and *what tier label
  they carry*. Any filtering logic appearing in a wrapper is a bug.

### 2.3 `india-scan.mjs` (Tier 1)

Wrapper: `SOURCE_TIER = 'indeed'`, id tag `indeed_id`. Reads already-fetched
connector results; it does not call Indeed itself (§4.1 in ARCHITECTURE).

### 2.4 `careers-scan.mjs` (Tier 3)

```js
export function loadSeedCompanies(): object[]
export function loadCoveredCompanies(): Set<string>
export function tierTargets(): object[]
export function scopeViolation(company, url): string | null
```

`scopeViolation` returns a human-readable reason or `null`. The three scope
rules of FUNCTIONAL §3.2 are implemented here, in code — the mode file describes
them but is not trusted to enforce them. `--list-targets` prints what a sweep
would cover without running it.

### 2.5 `outreach-draft.mjs`

```js
export function numericClaims(text): string[]
export function claimIsGrounded(claim, cvClaims): boolean
export function validatePayload(payload, {cvText, existingLog}): {ok, errors}
export function contactRow(payload): string
export { main, CONTACT_TYPES }
```

`numericClaims` extracts numeric tokens with their units. The regex uses a
**negative lookahead** as its trailing guard, not `\b`:

```js
/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(percent|lakhs?|crores?|pp|cr|mn|bn|%|k|l|m|b|x)?(?![a-z0-9])/gi
```

`\b` cannot match after `%` — both sides are non-word characters — so the engine
backtracked and dropped the suffix, making `40%` compare as `40`. That made the
grounding check pass in one direction and fail in the other.

Handles: year exclusion, Indian scale suffixes (`40L`, `3 crore`), and bare
counts (`40 partners`).

**There is no send path in this file, and none may be added.**

### 2.6 `add-company.mjs`

```js
export function normalizeHost(url): string
export function isNonEmployerHost(host): boolean
export function deriveCompany(url): string
export function companyKey(name): string
export function applyAddCompany(args): object
```

Refuses aggregator and ATS hosts as company identities. Flag parsing uses an
explicit operand index — computing `websiteIdx + 1` yields `0` when the flag is
absent, which silently consumed the company name.

### 2.7 Web libraries

```js
// web/src/lib/job-signals.mjs
export function parseNoteTags(notes): object
export function jobSignals(row): object
export function countByMarket(rows): object
export const SOURCE_LABELS, COMPANY_TYPE_LABELS

// web/src/lib/pm-dimensions.mjs
export function machineSummaryBlock(md): string
export function parsePmDimensions(md): object
export function machineSummaryField(md, key): string
export { LABELS as DIMENSION_LABELS }
```

`machineSummaryBlock` normalizes line endings before parsing. JavaScript's `.`
excludes `\n` but **includes** `\r`, so a CRLF-checked-out report matched
patterns in ways an LF one did not.

---

## 3. Data formats

### 3.1 Pipeline row note tags

Ingested rows carry structured tags in their note field, parsed back by
`parseNoteTags`:

```
source=indeed market=india indeed_id=abc123
```

Keys are stable; unknown keys are ignored rather than erroring, so a newer
writer cannot break an older reader.

### 3.2 Tracker TSV

One file per evaluation at `batch/tracker-additions/{num}-{slug}.tsv`. Nine
tab-separated columns plus optional tagged extras:

```
num  date  company  role  status  score/5  pdf  {report-link}  notes  {url}  {via=Agency}
```

- `{report-link}` is a root-relative markdown link of the form
  `[num](reports/{num}-{slug}-{date}.md)`; `merge-tracker.mjs` rewrites it
  relative to the tracker's own directory so it stays clickable.
- **Status precedes score in the TSV; score precedes status in
  `applications.md`.** `merge-tracker.mjs` performs the swap.
- Backfilled rows with no evaluation must carry a recognised score sentinel —
  `N/A`, `—`, or `-`. The column-swap guard identifies the score column by
  content pattern, so an unrecognised placeholder makes the row ambiguous and it
  is skipped with a warning.
- The trailing URL is the **deterministic dedupe key**, matched first and
  normalized (tracking params stripped, host lowercased, fragment and trailing
  slash dropped).
- `via=` must be tagged. A single untagged extra retains its legacy meaning
  (location).

### 3.3 `data/contacts.tsv` and `data/outreach-log.tsv`

Both append-only, both user-layer, both gitignored. Contacts is 9-column and
carries third-party PII, which is why it never enters the repo.

### 3.4 `data/status-log.tsv`

```
{tracker#}  {date}  {from}  {to}  {source}  {note}
```

Unknown from/to states use the sentinel `-`. The source column is a closed set.
The tracker remains the source of truth for *state*; the ledger records *when*.

---

## 4. Configuration

| File | Layer | Purpose |
|---|---|---|
| `config/profile.yml` | user | Identity, archetype ladder, markets, proof points, comp targets |
| `modes/_profile.md` | user | Targeting narrative |
| `modes/_custom.md` | user | Rubric override, house rules, cover-letter rules |
| `portals.yml` | user | ATS tenants, title filter, location filter |
| `config/india-seed-companies.yml` | user | 149 Tier-2/3 seed companies (gitignored) |
| `config/committed-user-layer.yml` | user | Declares which user-layer paths are committed on purpose, and why |
| `templates/*.yml`, `templates/*.md` | system | Shipped starting points for all of the above |

`modes/_custom.md` is the extension point that matters: `_shared.md` instructs
every mode to read it, so the PM rubric, the GCC handling and the cover-letter
rules are applied without editing a single system-layer file. An upstream update
is therefore a no-op against this fork's personalisation.

`scripts/setup-pm-india.mjs` installs the five templates to their user-layer
paths. It never overwrites without `--force`, which writes a `.bak` first.

---

## 5. The `web/` mirror

Turbopack pins the project root at `web/`, so `web/` cannot import modules from
the repo root. Two files are therefore mirrored:

| Root | Mirror |
|---|---|
| `market-map.mjs` | `web/src/lib/market-map.mjs` |

`tests/market-map-parity.test.mjs` fails the build if they diverge. The mirror is
a deliberate, tested duplication — not an accident, and not a licence to add
more without the same guard.

---

## 6. Tests

`test-all.mjs` runs numbered inline sections and then auto-discovers
`tests/**/*.test.mjs`. Helpers come from `tests/helpers.mjs`: `pass()`, `fail()`,
`warn()`, `run()`.

### 6.1 Fork test suites

| Suite | Freezes |
|---|---|
| `tests/market-map-parity.test.mjs` | Root and web copies of `market-map.mjs` are identical |
| `tests/pm-title-filter.test.mjs` | Both halves of the title filter — what it keeps *and* what it rejects |
| `tests/india-coverage.test.mjs` | Tier wiring, source tiers, scope enforcement |
| `tests/india-pm-calibration.test.mjs` | Calibration-set composition and the zero-product-marketing criterion |
| `tests/outreach-guards.test.mjs` | No file in the repo reaches for Gmail send / reply / forward |
| `web/tests/lib/job-signals.test.mjs` | Note-tag parsing and market counting |
| `web/tests/lib/pm-dimensions.test.mjs` | YAML-tail parsing, including CRLF |

### 6.2 Harness invariants

- **Per-script timeout budgets.** Section 2 executes each script from a
  throwaway repo copy with a 30 s default. Scripts that legitimately need
  longer declare `timeoutMs` — `update-system.mjs check` needs 180 s because it
  performs up to three 12 s curl calls and then a `git fetch` of upstream whose
  own budget is 300 s.
- **Failure recap.** `finish()` reprints failed assertion messages immediately
  before the summary line, bounded to 40 entries at 300 chars. The suite emits
  over 5,000 assertion lines and every consumer keeps only the tail, so without
  this a single failure is unattributable in practice.
- **Discovered suites may not call `finish()`.** Only `test-all.mjs` prints the
  global summary.

### 6.3 Coverage guards

- `validate-system-paths-coverage.mjs` — every system file is registered in
  `update-system.mjs`. `docs/` is a registered prefix, so new docs are covered.
- `validate-untrusted-content-coverage.mjs` — every ingestion path is declared.
- `tests/user-layer-gitignored.test.mjs` — every user-layer path is gitignored,
  except paths declared in `config/committed-user-layer.yml`, which are reported
  as warnings naming the reason.

---

## 7. CI

| Workflow | Runs |
|---|---|
| `test.yml` | Root suite on ubuntu / macOS / windows, Go dashboard tests, CV visual regression, upgrade regression gate |
| `web-ci.yml` | `web/` typecheck and build |
| `no-user-data.yml` | Blocks any PR adding user-layer files, reading the exemption declaration from the **base** ref |
| `dependency-review.yml`, `sbom.yml` | Supply chain |
| `codeql.yml` | Static analysis. Runs to completion but cannot upload on a repo without code scanning enabled |

Eleven upstream contributor-community workflows are reduced to
`workflow_dispatch` in this fork, with their original triggers recorded in a
comment above each. `release.yml` in particular would otherwise cut releases of
a fork that publishes nothing.

### 7.1 Windows

`core.autocrlf false` is forced before checkout. The repo is committed with LF
and `.gitattributes` sets `* text=auto eol=lf`; without the override, Windows
rewrites every text file and regexes relying on `.` (which excludes `\n` but not
`\r`) fail in ways no other platform sees.
