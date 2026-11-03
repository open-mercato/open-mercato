# Checkpoint 3 — Steps 3.1..3.3 (Phase 3 closed: picker + validation)

**Steps covered:** 3.1 (8dbf86e1b) · 3.2 (2985c3a3f) · 3.3 (f274bf78c)
**Recorded:** 2026-07-28 (UTC) · **Runner:** local

## Checks
| Check | Result | Notes |
|---|---|---|
| build:packages / generate / typecheck | ✅ | |
| yarn i18n:check-sync | ✅ | |
| Scoped jest core→workflows | ✅ | 1012 tests (+35 this window) |
| UI integration | ⏭ skipped | final gate |

## Notes
- Honest scope reductions recorded: trigger sourceExpressions get no context picker (event-payload domain); sub-workflow OUTPUT mappings get no picker (child context). One shared client ledger feeds both the picker and the ref-checker, so the picker never offers a path the checker would flag.

## Corrections
- SHAs trued up: 3.1→8dbf86e1b, 3.2→2985c3a3f, 3.3→f274bf78c.
