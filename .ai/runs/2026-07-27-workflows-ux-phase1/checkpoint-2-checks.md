# Checkpoint 2 — Steps 2.1..4.3

**Steps covered:** 2.1 (352ccb1c4) · 3.1 (b2699c39d) · 4.1 (94b50edd3) · 4.2 (6c986ee52) · 4.3 (fd323ee66)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local

## Touched areas
- data/ (activity-config-schemas NEW, activity-config-warnings NEW, validators registry-driven enum), lib/ (set-variable NEW, transition-handler merge extension, activity-types SET_VARIABLE + form specs), components/fields/ (useActivityTypeOptions NEW, ActivityConfigFields NEW, ActivityArrayEditor form-first), visual-editor page (config-warning merge), i18n ×4 (SET_VARIABLE + activityConfig keys)

## Checks
| Check | Result | Notes |
|---|---|---|
| yarn build:packages / generate / typecheck | ✅ | |
| yarn i18n:check-sync | ✅ | |
| Scoped jest packages/core → workflows | ✅ | 779 tests (+42 this window); executor suite still unedited |
| UI integration | ⏭ skipped | deferred to final gate (ephemeral suite) |

## Corrections
- Tasks-table SHAs trued up: 2.1→352ccb1c4, 3.1→b2699c39d, 4.1→94b50edd3, 4.2→6c986ee52, 4.3→fd323ee66.
