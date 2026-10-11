# Workflow Task Completion Guards

## TLDR

**Key points:**

- A host module registers **task completion guards** (`registerTaskCompletionGuards`) that can veto a user-task completion with a coded reason.
- Guards are consulted **inside `completeUserTask`**, before anything is mutated, so the HTTP route, the `workflows.tasks.complete` command (notification quick action) and in-process `taskHandler` callers are all covered by one check.
- The same registry is evaluated in a **non-mutating preview** on the task detail route, so `canComplete` turns false, `actBlockedReason` becomes `completion-guard` and the additive `completionGuard` field carries the guard's code and message key.
- A workflow with no matching guard behaves exactly as before, and with no guard registered at all the handler performs no extra query.

**Scope:** `packages/core/src/modules/workflows` only — a new pure-ish registry module, the task handler, the complete route and command, the task detail route/affordances, the task detail notice, i18n and docs.

**Primary risks:** a new shared contract on the path every completion goes through; a throwing guard; a guard that mutates during the preview.

## Overview

`completeUserTask` (`lib/task-handler.ts`) is the one function every completion path reaches: `POST /api/workflows/tasks/[id]/complete` calls it directly, the `workflows.tasks.complete` command (behind the notification quick action) calls it, and other modules call the `taskHandler` DI service. None of these offered a seam for a host-owned precondition ("the related record must be in state X first"). The route is a custom route that calls the handler directly, so neither command interceptors nor the CRUD mutation-guard registry see it.

The read side mirrored the gap: the task detail route serves `canComplete` / `actBlockedReason` (`TaskAffordances`), but they are a pure projection of the §6.4 visibility decision, so a UI kept offering a Complete button the host would reject.

Related: [`2026-07-15-contextual-workflow-task-actions.md`](2026-07-15-contextual-workflow-task-actions.md) (UIs render Complete only on the server-provided `canComplete`), which this extends with host-contributed vetoes. Issue #7179 (completion-surface declaration) is complementary and out of scope.

## Problem Statement

1. A module that owns a completion precondition must withhold every `workflows.*` feature from its roles and re-implement completion in its own endpoint.
2. UIs offer a Complete action that the host would refuse, because `canComplete` cannot see host preconditions.

## Proposed Solution

### Registry

`lib/task-completion-guards.ts`:

```ts
export type TaskCompletionGuard = {
  id: string
  workflowId?: string | readonly string[]   // omitted = any workflow
  stepId?: string | readonly string[]       // omitted = any step
  formKey?: string | readonly string[]      // task-level key (userTaskConfig.formKey); omitted = any
  priority?: number                         // lower runs first, default 50
  evaluate(input: TaskCompletionGuardInput): Promise<TaskCompletionGuardResult> | TaskCompletionGuardResult
}

export type TaskCompletionGuardResult =
  | { ok: true }
  | { ok: false; code: string; messageKey?: string; message?: string; details?: Record<string, unknown> }
```

- `registerTaskCompletionGuards([{ moduleId, guards }])` merges by `moduleId` (re-registering a module replaces only its own guards), stored on `globalThis` like the work-inbox sources so bundle duplication cannot split the registry. Modules call it from their `di.ts` at load time.
- `taskCompletionGuards` is also registered in DI (the module namespace) for callers that prefer resolving it.
- `TaskCompletionGuardInput` carries the trusted scope (`tenantId`, `organizationId` — taken from the task row, never from the request), `userId`, `mode: 'complete' | 'preview'`, a read-only task snapshot, the resolved `workflowId` / `stepId` / `formKey` / `workflowInstanceId`, `formData` and `decisionId` (complete mode only), plus `em` and `container` for host reads.
- Guards MUST be read-only. In preview mode the evaluator hands them a forked `EntityManager` and never flushes.

### Evaluation semantics

- Guards are filtered by selector (every declared selector must match) and run in `priority` order; the **first** veto wins.
- **Fail closed:** a guard that throws, or returns anything other than `{ ok: true }`, blocks. A throw yields code `COMPLETION_GUARD_FAILED` and is logged; the original error is never echoed to the caller.
- An empty or non-string `code` falls back to `TASK_COMPLETION_BLOCKED`.
- When no guard is registered, the evaluator returns immediately without loading the instance/definition.

### Enforcement

`completeUserTask` evaluates guards after the task lookup, ownership, form validation and decision resolution and **before** any mutation. A veto throws `TaskCompletionBlockedError` (extends `UserTaskError`; `code` = the guard code, `status` = 409, `guardId`, `messageKey`).

| Path | Result on veto |
| --- | --- |
| `POST /api/workflows/tasks/[id]/complete` | `409 { error, code, guardId, messageKey }` |
| `workflows.tasks.complete` command (notification action) | throws `CrudHttpError(409, same body)`; the notifications action route answers the same 409 |
| `taskHandler.completeUserTask(...)` | throws `TaskCompletionBlockedError` with the same code |

### Affordances

`resolveTaskAffordances(principal, task, decision, completionBlock?)` gains an optional fourth argument. When the visibility decision would allow completion and a block is supplied, `canComplete` is false and `actBlockedReason` is `'completion-guard'`. The guard is consulted only when the caller could otherwise complete the row, so every existing reason keeps its precedence. The task detail route adds `completionGuard: { guardId, code, messageKey } | null`.

The task detail page renders the guard's `messageKey` (falling back to the generic `workflows.tasks.detail.blocked.completionGuard` sentence) through the existing `TaskActionNotice`.

## Architecture

```
route / command / in-process caller
          │
          ▼
 completeUserTask ── lookup → ownership → form → decision
          │
          ├─ evaluateTaskCompletionGuards(mode: 'complete')  ── veto → TaskCompletionBlockedError (409)
          ▼
   mutate task, resume workflow (unchanged)

GET /api/workflows/tasks/[id]
   decideTaskAccess → (actable?) evaluateTaskCompletionGuards(mode: 'preview', forked em)
                    → resolveTaskAffordances(..., completionBlock)
```

## Data Models

No entity or migration change.

## API Contracts

- `GET /api/workflows/tasks/[id]`: additive `completionGuard` (nullable object); `actBlockedReason` enum gains `completion-guard`.
- `POST /api/workflows/tasks/[id]/complete`: new `409` body `{ error, code, guardId, messageKey }` when a guard vetoes.
- No route, event, ACL feature or DI name is removed or renamed. New DI name: `taskCompletionGuards`.

## Integration Coverage

| Path | Coverage |
| --- | --- |
| `completeUserTask` direct call (veto, pass, no guards, throwing guard, selector mismatch) | `lib/__tests__/task-completion-guards.test.ts` |
| `POST /api/workflows/tasks/[id]/complete` veto → 409 | `api/__tests__/taskActions.route.test.ts` |
| `workflows.tasks.complete` command veto → 409 `CrudHttpError` | `commands/__tests__/tasks.test.ts` |
| `GET /api/workflows/tasks/[id]` `canComplete:false` + `completionGuard`, no mutation | `api/__tests__/taskDetail.route.test.ts` |
| Task detail notice renders the guard message | `backend/tasks/__tests__/taskDetailPage.test.tsx` |

Guards are registered only by host modules; no shipped module registers one, so a Playwright scenario would need a test-only module. The unit/route coverage above exercises every path end to end at the handler boundary.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| Guard throws or times out the request | High | every completion | Fail closed with `COMPLETION_GUARD_FAILED`, logged | A broken guard blocks its own workflows until fixed — intended |
| Guard mutates state during preview | Medium | task detail GET | Forked EM, never flushed; contract documents read-only | A guard doing its own raw writes is a host bug |
| Extra queries on every completion | Low | performance | Zero-guard fast path; target loaded only when guards exist | One instance/definition read per guarded completion |
| Old client sees unknown `completion-guard` reason | Low | UI | `describeTaskActionBlock` already renders unknown reasons as `unavailable` | None |
| Cross-tenant leak through guard input | High | security | Scope taken from the already tenant-scoped task row | None |

## Final Compliance Report

- Backward compatibility: additive only (new optional function arg, new enum value in a response, new optional response field, new DI name, new error subclass of `UserTaskError`).
- Tenant scoping: guard scope comes from the scoped task row.
- No ORM relations, no generated files, no migrations.
- i18n: new key in every workflows locale (en, de, es, pl, ko).

## Changelog

- 2026-10-11: Initial spec and implementation (issue #7178).
