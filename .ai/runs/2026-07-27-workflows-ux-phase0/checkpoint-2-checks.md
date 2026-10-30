# Checkpoint 2 — Steps 3.2..4.3

**Steps covered:** 3.2 (1f95b7e23) · 3.3 (2c05a0d6e) · 4.1 (c15d25fa0) · 4.2 (0eccd7584) · 4.3 (c91235342)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local

## Touched areas in this window

- `packages/core/src/modules/workflows/components/` — WorkflowNodeCard + all 9 node components (error badges), ConfigJsonTextarea (new), ActivitiesEditor/TransitionsEditor (JSON feedback), NodeEditDialog/EdgeEditDialog (DurationInput adoption), fields/ActivityArrayEditor + NodeEditDialogCrudForm (DurationCrudField)
- `packages/ui/src/backend/inputs/` — DurationInput (new primitive + 33 tests)
- `apps/mercato/src/i18n/*` + `packages/create-app/template/src/i18n/*` — ui.durationInput.* keys (template mirrored per Template Sync rule)
- `packages/core/src/modules/workflows/i18n/*` — badge/invalid-JSON keys, duration hint rewording

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ pass | |
| `yarn generate` | ✅ pass | |
| `yarn typecheck` | ✅ pass | 21/21 tasks |
| `yarn i18n:check-sync` | ✅ pass | |
| Scoped jest `packages/core` → workflows | ✅ pass | 47 suites / 669 tests |
| Scoped jest `packages/ui` → backend/inputs | ✅ pass | 103 tests (incl. 33 DurationInput) |
| UI integration / screenshots | ⏭ skipped | Dev env still not provisioned in worktree; deferred to final gate (rule: UI checks never block development) |

## Notes

- Step 4.2 observed one jest worker SIGSEGV on `step-handler.test.ts`; dispatcher re-ran it in isolation — 16/16 pass, confirmed flake.
- pl.json was corrupted once by a perl edit in step 3.2 and repaired before landing; JSON-safe-edit rule added to all subsequent executor briefs.
- Tasks-table `Commit` cells for 3.2–4.3 trued up to post-amend SHAs in this checkpoint commit.
