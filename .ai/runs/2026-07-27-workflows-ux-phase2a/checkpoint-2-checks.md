# Checkpoint 2 — Steps 2.1..2.3 (Phase 2 closed: the ledger)

**Steps covered:** 2.1 (892e73b61) · 2.2 (3e03f7f04) · 2.3 (d9caa2097)
**Recorded:** 2026-07-28 (UTC) · **Runner:** local

## Checks
| Check | Result | Notes |
|---|---|---|
| build:packages / generate / typecheck | ✅ | 21/21 |
| Scoped jest core→workflows | ✅ | 977 tests (+64 this window) |
| UI integration | ⏭ skipped | final gate |

## Notable findings recorded
- Ledger models verified reality, contradicting the triage inventory twice: AUTOMATED sync outputs never persist to instance.context (only stepInstance.outputData); SUB_WORKFLOW outputMapping is computed but never merged — the ledger refuses to advertise both. The sub-workflow one is a candidate engine defect → follow-up issue at run end.
- Presence semantics: continueOnActivityFailure degrades contributions to maybe; trigger/signal entries are maybe by design.

## Corrections
- SHAs trued up: 2.1→892e73b61, 2.2→3e03f7f04, 2.3→d9caa2097.
