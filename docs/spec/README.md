# Job-finder — specification set

Four documents describing what this fork is, what it does, and how it is built.
They cover **Job-finder specifically** — the PM/India re-shaping of career-ops
defined by PRD v2. The base system it sits on is documented upstream and is not
repeated here.

| Document | Answers |
|---|---|
| [FEATURES.md](FEATURES.md) | What can it do? One line per capability, with its entry point and status. |
| [FUNCTIONAL.md](FUNCTIONAL.md) | What does it do, from the outside? Journeys, rules, guarantees, acceptance criteria. |
| [TECHNICAL.md](TECHNICAL.md) | How is it built? Module contracts, data formats, invariants, tests. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why is it shaped this way? Layers, boundaries, and the decisions behind them. |

## Read these first

Nothing here supersedes the operating rules. Where this set and the rules
disagree, the rules win and this set has a bug.

| File | Authority |
|---|---|
| [`AGENTS.md`](../../AGENTS.md) | The operating contract every agent reads. Source-of-truth boundary, untrusted-content rules, ethical limits. |
| [`DATA_CONTRACT.md`](../../DATA_CONTRACT.md) | Which files are the user's and which are the system's. |
| [`modes/_custom.md`](../../modes/_custom.md) | This candidate's live rubric and house rules. Read by every mode. |
| [`PM-INDIA.md`](../../PM-INDIA.md) | The fork's user-facing guide. Start here if you want to *use* it. |

## Base-system architecture

Job-finder is a fork of [career-ops](https://github.com/santifer/career-ops).
The base system's own architecture docs are still accurate and still apply:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — principles, layers, component map
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — evaluation flow, batch processing, pipeline integrity

[ARCHITECTURE.md](ARCHITECTURE.md) in this directory describes only what the
fork adds on top, and links back rather than restating.

## Status of this set

Written 2026-08-25 against the branch that implements PRD v2. Every claim was
checked against the source at the time of writing rather than recalled. Where a
capability is specified but not yet verifiable in this environment, it is marked
so explicitly — see the status column in [FEATURES.md](FEATURES.md).
