# Checkpoint 1 — Steps 1.1..3.1

**Steps covered:** 1.1 (494ba36ec) · 2.1 (b87fb2b0d) · 2.2 (4261372e2) · 2.3 (8c4521a5e) · 3.1 (2a6b9b9eb)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local (no compose `app` container in this worktree)

## Touched areas in this window

- `packages/core/src/modules/workflows/lib/` — activity-executor (SEND_EMAIL), new collect-validation-issues helper
- `packages/core/src/modules/workflows/components/` — ActivitiesEditor, TransitionsEditor (retry-policy renames), WorkflowGraph/WorkflowGraphImpl (focusTarget)
- `packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx` — problems panel, formatted save errors
- `packages/core/src/modules/workflows/setup.ts` + `__tests__/acl-dependencies.test.ts` — employee default grants
- `packages/core/src/modules/workflows/i18n/{en,pl,es,de}.json` — retry-policy key cleanup + problems-panel keys
- `.ai/specs/` + `.ai/mockups/workflows-ux-redesign/` — docs (Step 1.1)

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ pass | 21/21 tasks |
| `yarn generate` | ✅ pass | |
| `yarn typecheck` | ✅ pass | 21/21 tasks |
| `yarn i18n:check-sync` | ✅ pass | all locales in sync |
| Scoped jest `packages/core` → `src/modules/workflows` | ✅ pass | 44 suites, 651 tests |
| UI integration / screenshots | ⏭ skipped | Dev env (DB, app server) not provisioned in this worktree; root-invocation `yarn jest <path>` hits TS5011 rootDir config issue — package-scoped invocation is the correct runner. Full `yarn test:integration` + UI evidence deferred to the final gate per skill rules (UI checks must not block development). |

## Corrections

- Tasks-table `Commit` cells for 1.1–3.1 trued up to the final (post-amend) SHAs in this checkpoint commit; per-step cells recorded pre-amend SHAs due to the amend convention.
