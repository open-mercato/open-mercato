# 2026-07-25 — workflows: invalidate trigger cache on customize / reset-to-code (#4425 follow-up)

Source doc: .ai/specs/implemented/2026-04-14-code-based-workflow-definitions.md

## Goal

Close the two residual items left on issue #4425 after its root fix landed on `develop`, so a code-defined
workflow's triggers behave predictably across the full `customize` / `reset-to-code` lifecycle and the
three-source trigger model is documented for module authors.

## Context

Issue #4425 ("triggers declared on code-defined workflows never reach the trigger engine") was fixed on
`develop` by PR #4463 (`4e5aabe8b`): `loadTriggersForTenant` now projects `getAllCodeWorkflows()` triggers as
`source: 'code'` `UnifiedTrigger`s, and any `workflow_definitions` row for the same `workflowId` (including a
disabled one) suppresses the code projection. Verified in this worktree: `4e5aabe8b` is an ancestor of HEAD.

Two residual items were reported on the issue while verifying that merged fix:

1. **`customize` / `reset-to-code` do not invalidate the trigger cache.** Both endpoints change *which source
   owns* a workflow's triggers (code projection ↔ embedded DB row), but neither calls
   `invalidateTriggerCache(...)` — only `POST /api/workflows/definitions` and
   `PUT|DELETE /api/workflows/definitions/[id]` do. The wildcard subscriber therefore keeps the previous
   snapshot for up to the 5-minute `TRIGGER_CACHE_TTL`: after `customize` it keeps matching the code trigger,
   and after `reset-to-code` it keeps matching the embedded trigger of a row that no longer exists.
2. **Docs do not describe the three-source model.** `packages/core/src/modules/workflows/AGENTS.md`
   § Event Triggers still describes triggers as coming from a definition's `triggers[]` array only, without the
   legacy/embedded/code sources, the "DB row wins" precedence, or the cache-invalidation requirement. The risk
   register in the source spec still lists this as an open Phase 2 gap.

## Scope

- `packages/core/src/modules/workflows/api/definitions/[id]/customize/route.ts`
- `packages/core/src/modules/workflows/api/definitions/[id]/reset-to-code/route.ts`
- `packages/core/src/modules/workflows/api/definitions/[id]/__tests__/trigger-cache-invalidation.test.ts` (new)
- `packages/core/src/modules/workflows/AGENTS.md`
- `.ai/specs/implemented/2026-04-14-code-based-workflow-definitions.md`

## Non-goals

- No change to the trigger loader, matcher, or the code projection itself — that shipped in #4463.
- No change to `TRIGGER_CACHE_TTL`, to the cache's `globalThis` parking, or to any other write path.
- No new invalidation on read paths.

## Risks

- **Low.** Two added invalidation calls only widen an existing, already-used code path; the worst case of an
  extra invalidation is one cold trigger load per tenant/organization. The failure mode being removed is bounded
  by the TTL and never executes a wrong definition (`findWorkflowDefinition` resolves the current one), so this
  is a correctness-of-matching fix, not a data-safety fix.

## Progress

PR: #4509

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Invalidate the trigger cache on both ownership-changing routes

- [x] 1.1 Verify in repo that `4e5aabe8b` is present and that neither route calls `invalidateTriggerCache`
- [x] 1.2 `customize/route.ts`: invalidate after the flush that materializes the override — a1082141b
- [x] 1.3 `reset-to-code/route.ts`: invalidate after the flush that removes the override — a1082141b
- [x] 1.4 Unit test covering both endpoints, including the 409 active-instances path that must NOT invalidate — a1082141b

### Phase 2: Document the three-source trigger model

- [x] 2.1 `workflows/AGENTS.md` § Event Triggers: sources table, "DB row wins" precedence, invalidation rule — defc3af16
- [x] 2.2 Spec: close the #4425 Phase 2 gap in the risk register, add the stale-cache risk, extend the changelog — defc3af16

### Phase 3: Validation and delivery

- [x] 3.1 Run the configured validation gate — green on 99f11ba71 (build:packages, generate, i18n:check-sync, i18n:check-usage, typecheck, test 23/23 tasks, lint)
- [x] 3.2 Open the PR against `develop` and apply labels — PR #4509 (labels requested from a maintainer; this account has no triage permission)
