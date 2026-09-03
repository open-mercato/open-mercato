# Checkpoint 3 — Steps 4.4..4.6 (Phase 4 closed: all 8 types form-first)

**Steps covered:** 4.4 (8ded5a899) · 4.5 (fd1b2f2cd) · 4.6 (be5841f08)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local

## Touched areas
- lib/workflow-safe-commands (list export), lib/workflow-function-registry (new), api/commands + api/functions routes (new, typed openApi), components/fields (CommandPicker, FunctionPicker, AssignmentRowsEditor in ActivityConfigFields), activity-types form specs, i18n ×4

## Checks
| Check | Result | Notes |
|---|---|---|
| yarn build:packages / typecheck | ✅ | |
| yarn i18n:check-sync | ✅ | |
| Scoped jest packages/core → workflows | ✅ | 810 tests |
| UI integration | ⏭ skipped | final gate |

## Corrections
- SHAs trued up: 4.4→8ded5a899, 4.5→fd1b2f2cd, 4.6→be5841f08.
