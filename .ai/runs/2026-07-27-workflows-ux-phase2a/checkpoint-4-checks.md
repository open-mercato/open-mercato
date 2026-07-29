# Checkpoint 4 — Steps 4.1..4.4 (Phase 4 closed: samples + test step)

**Steps covered:** 4.1 (bcd7ee91e) · 4.2 (0aa5714ed) · 4.3 (7558db879) · 4.4 (1972a0992)
**Recorded:** 2026-07-28 (UTC) · **Runner:** local

## Checks
| Check | Result | Notes |
|---|---|---|
| build:packages / generate / typecheck | ✅ | |
| yarn i18n:check-sync | ✅ | |
| Scoped jest core→workflows | ✅ | 1056 tests (+44 this window) |
| UI integration | ⏭ skipped | final gate |

## Notes
- Test loop closed: ledger placeholder → mock-first simulation (execute unreachable from the route) → pin-as-sample (no-redaction warning) → picker sample values.
- New ACL feature `workflows.definitions.test_run` (dependsOn definitions.edit); admin wildcard covers; UPGRADE note due in 5.2.

## Corrections
- SHAs trued up: 4.1→bcd7ee91e, 4.2→0aa5714ed, 4.3→7558db879, 4.4→1972a0992.
