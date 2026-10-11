# Execution plan — workflows task completion guards

Source issue: open-mercato/open-mercato#7178
Source doc: .ai/specs/2026-10-11-workflows-task-completion-guards.md

## Goal

Let a host module veto a user-task completion with a coded reason, enforced inside
`completeUserTask` (so the HTTP route, the `workflows.tasks.complete` command / notification
quick action and in-process `taskHandler` callers are all covered), and reflect the same veto in
the server-computed `canComplete` / `actBlockedReason` affordances without mutating anything.

## Scope

- `packages/core/src/modules/workflows/lib/task-completion-guards.ts` (new registry + evaluator)
- `lib/task-handler.ts` (consult guards before any mutation, `TaskCompletionBlockedError`)
- `lib/task-visibility.ts` + `lib/task-visibility-request.ts` (new `completion-guard` block reason)
- `api/tasks/[id]/complete/route.ts`, `commands/tasks.ts` (409 with the guard code)
- `api/tasks/[id]/route.ts`, `api/openapi.ts`, `data/types.ts` (additive `completionGuard` field)
- `lib/work-inbox/presentation.ts`, task detail page + notice (render the guard's message key)
- `di.ts` (`taskCompletionGuards` DI seam), i18n, AGENTS.md, spec

## Non-goals

- #7179 (completion-surface declaration) — separate issue.
- Changing notification quick-action offering (decided at assignment time); the command path is
  still guarded at execution time.
- Guards on claim / release / reassign.

## Risks

- Shared contract surface on every completion path → additive only; with no guard registered the
  handler performs zero extra queries (regression test).
- A throwing guard must fail closed (`COMPLETION_GUARD_FAILED`).

## Progress

PR: #7191

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spec and registry

- [x] 1.1 Write the spec — 4d8da8465
- [x] 1.2 Add the completion-guard registry, matcher and evaluator with unit tests — 403d40f75

### Phase 2: Enforcement

- [x] 2.1 Consult guards inside completeUserTask (direct call path) with tests — 403d40f75
- [x] 2.2 Map the veto to 409 on the HTTP route and the command with tests — eaf8e1f8f

### Phase 3: Affordances and UI

- [x] 3.1 Feed the non-mutating evaluation into resolveTaskAffordances and the task detail route — 63537d221
- [x] 3.2 Render the guard reason on the task detail page, i18n, docs — 63537d221
