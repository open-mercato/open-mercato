# Operation Progress Framework

## TLDR

Make progress tracking mandatory and reusable for every user-visible bulk operation and every future long-running operation. The existing product bulk delete flow is the reference server-side pattern: create a `ProgressJob`, enqueue the work, update progress from the worker, and return `progressJobId` to the DataTable action. Client-local loops may use shared frontend progress events only when the operation must remain in-page and cannot continue after navigation.

## Overview

Open Mercato already has the core primitives:

- `packages/core/src/modules/progress` owns `ProgressJob`, `ProgressService`, progress APIs, and `ProgressTopBar`.
- `packages/ui/src/backend/DataTable.tsx` understands injected bulk actions that return `{ progressJobId }`.
- Catalog product bulk delete uses a queued worker plus `ProgressService` and shows progress correctly.
- Customer people, companies, and deals bulk deletes historically ran row-by-row in the browser; they emitted undo metadata per request but did not surface progress until the local progress event bridge was added.

This spec turns those scattered patterns into a platform contract.

## Problem Statement

Bulk operations are inconsistent:

1. Some operations show top-bar progress because they create `ProgressJob` records.
2. Some DataTable `bulkActions` execute long client-side loops with no visible top-bar status.
3. Future operations have no explicit rule for choosing server progress vs. local progress.
4. Agents can add new bulk work by copying older list-page patterns and accidentally regress UX.

The result is an operator experience where selected-row operations may appear idle, especially when deleting or updating many records.

## Goals

- Every DataTable bulk action that mutates records MUST show progress.
- Every queued/background operation MUST create and maintain a `ProgressJob`.
- Every future operation expected to run longer than one second, touch multiple records, or survive navigation MUST use the operation progress framework.
- Progress must remain tenant- and organization-scoped.
- Existing undo and command audit metadata must continue to work for CRUD mutations.

## Non-Goals

- Do not replace the audit/undo `LastOperationBanner`.
- Do not make single-row CRUD actions create `ProgressJob`s by default.
- Do not introduce raw polling loops in feature modules.
- Do not migrate every existing operation in one PR; rollout can be phased.

## Proposed Solution

### Canonical Operation Progress Contract

Use one of two progress modes:

| Mode | When to use | Required behavior |
|------|-------------|-------------------|
| Server progress (`ProgressJob`) | Bulk work, queued work, operations that can continue after navigation, imports/exports, reindexing, remote API sync, destructive large mutations | Create a `ProgressJob`, enqueue or run work with `ProgressService`, return `progressJobId`, and update status until `completed`, `failed`, or `cancelled`. |
| Client-local progress event | Short in-page loops where each row must remain a browser request to preserve existing response-side metadata, and the work cannot continue after navigation | Use shared UI helpers that emit `om:progress:update`; do not hand-roll progress state or custom top bars. |

Single-row CRUD actions should keep using normal loading state and the audit/undo operation banner unless the action is unusually long-running.

### DataTable Bulk Action Rules

`DataTable` should treat all bulk actions as progress-aware:

1. Injected bulk actions already support `{ ok, message, progressJobId }`; keep this as the canonical server-progress result.
2. Prop-based `bulkActions` should support the same result contract.
3. Shared bulk helpers (`runBulkDelete` and future `runBulkOperation`) should emit local progress when passed progress metadata.
4. DataTable should clear selection only after the bulk action has either started a tracked job or completed/fails locally.

### Server Progress Rules

For server-side bulk work:

1. Add a dedicated API route to validate input and create the `ProgressJob`.
2. Return `202` with `{ ok: true, progressJobId, message }`.
3. Enqueue a module worker through `@open-mercato/queue`.
4. In the worker, resolve `progressService` and `commandBus` from DI.
5. Use command handlers for each mutation; do not mutate domain state directly in workers.
6. Call `startJob`, `updateProgress`/`incrementProgress`, then `completeJob` or `failJob`.
7. Support `isCancellationRequested` for cancellable jobs.
8. Scope all reads and writes by `tenantId` and `organizationId`.

### Client-Local Progress Rules

For client-side loops:

1. Use shared frontend progress events from `@open-mercato/shared/lib/frontend/progressEvents`.
2. Generate `client:*` job ids so local jobs do not collide with persisted `ProgressJob` ids.
3. Include `jobType`, `name`, `processedCount`, `totalCount`, `progressPercent`, and terminal status.
4. Let `ProgressTopBar` merge local jobs with server jobs.
5. Keep local progress best-effort only; it must not be the source of truth for work that survives navigation.

## Architecture

### Packages

| Package | Responsibility |
|---------|----------------|
| `packages/core/src/modules/progress` | Authoritative server progress model, events, APIs, and `ProgressService`. |
| `packages/ui/src/backend/progress` | `ProgressTopBar`, SSE/polling hooks, and client-local progress merge. |
| `packages/ui/src/backend/DataTable.tsx` | Bulk action execution and top-bar integration for `progressJobId` results. |
| `packages/ui/src/backend/utils` | Shared bulk helpers that emit local progress for browser-bound loops. |
| `packages/queue` | Background processing for server-side progress jobs. |

### Naming

Use stable `jobType` values:

- `catalog.products.bulk_delete`
- `customers.people.bulk_delete`
- `customers.companies.bulk_delete`
- `customers.deals.bulk_delete`
- Future format: `<module>.<resource>.<operation>`, where `resource` is plural only when it names a list surface and `operation` is snake_case.

### Backward Compatibility

- Additive only: existing `ProgressJob` API contracts remain unchanged.
- Additive only: `ProgressUpdateDetail` may gain optional fields, but existing required fields remain stable.
- Existing DataTable `bulkActions` that return `void` or `boolean` continue to work, but new mutating bulk actions MUST use progress.
- Existing injected bulk actions returning `progressJobId` remain valid.

## Implementation Plan

### Phase 1 — Guidance and Contract

1. Add this spec.
2. Add agent rules to root `AGENTS.md`, `packages/ui/AGENTS.md`, `packages/core/AGENTS.md`, and `packages/core/src/modules/progress/AGENTS.md`.
3. Document products as the reference server-side implementation and customers as the reference client-local fallback.

### Phase 2 — Shared UI Framework

1. Extend prop-based `DataTable.bulkActions` to handle `{ progressJobId }` like injected bulk actions.
2. Extract a general `runBulkOperation` helper from `runBulkDelete` so non-delete operations can emit local progress.
3. Add unit tests for local progress merge in `useProgressPoll` and `useProgressSse`.
4. Add unit tests for prop bulk action `{ progressJobId }` handling.

### Phase 3 — Server Bulk Operation Helper

1. Add a reusable helper for creating a `ProgressJob`, enqueueing work, and returning the standard `202` response.
2. Add a worker-side helper that wraps `startJob`/`updateProgress`/`completeJob`/`failJob`.
3. Ensure helpers accept tenant/org/user scope explicitly.
4. Ensure helpers do not bypass command handlers.

### Phase 4 — Rollout

1. Audit current `bulkActions`, `:bulk-actions` widgets, import/export actions, reindex operations, and multi-record mutation routes.
2. Convert eligible client-local loops to server jobs when they should survive navigation.
3. Keep client-local progress only for operations that intentionally preserve browser-side response metadata.
4. Add integration coverage for at least one prop bulk action and one injected bulk action.

## API Contracts

### Bulk Action Result

```ts
type BulkActionExecuteResult = {
  ok: boolean
  message?: string
  affectedCount?: number
  progressJobId?: string | null
}
```

### Progress Start Response

```json
{
  "ok": true,
  "progressJobId": "uuid",
  "message": "Bulk operation started."
}
```

### Local Progress Event

```ts
type ProgressUpdateDetail = {
  jobId: string
  jobType: string
  name: string
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}
```

Optional display fields may include `description`, `meta`, `etaSeconds`, `startedAt`, `finishedAt`, `errorMessage`, and `cancellable`.

## Testing Plan

- Unit: `runBulkDelete` emits start, step, and terminal progress events.
- Unit: future `runBulkOperation` handles success, partial failure, full failure, and empty input.
- Unit: `ProgressTopBar` hooks retain `client:*` jobs while merging `/api/progress/active` results.
- Unit: DataTable prop bulk action handles `{ progressJobId }` by clearing selection and showing the standard “started” flash.
- Integration: catalog products selected bulk delete returns `progressJobId` and appears in the top bar.
- Integration: customers people/companies/deals selected bulk delete emits visible progress and preserves undo banner metadata.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|------|----------|---------------|------------|---------------|
| Client-local progress disappears on navigation | Medium | Browser-bound bulk loops | Reserve local progress for in-page work only; server jobs are mandatory for durable operations. | Users can still navigate away and interrupt local loops. |
| Server bulk jobs bypass undo/audit metadata | High | Destructive mutations | Require command handlers from workers; do not mutate ORM rows directly. | Bulk undo may need coalescing per module. |
| Progress top bar becomes noisy | Medium | Backoffice shell | Hide only system/internal jobs with `meta.hiddenFromTopBar`; user-initiated bulk jobs must remain visible. | High-volume operators may see several recent jobs. |
| Queue worker retries duplicate mutations | High | Data integrity | Workers must be idempotent; commands should tolerate already-mutated records or record failures per item. | Some legacy commands may need hardening. |
| Progress ACLs block cancellation | Low | Cancellable jobs | Grant `progress.cancel` where modules expose cancellable jobs or provide module-specific cancel routes. | Existing roles may need sync. |

## Final Compliance Report

| Area | Status | Notes |
|------|--------|-------|
| Backward compatibility | Pass | All contracts are additive; no existing bulk action return type is removed. |
| Module isolation | Pass | Server work uses queue + command bus + DI; no cross-module ORM relationships. |
| Tenant security | Pass | Progress jobs and worker payloads carry `tenantId` and `organizationId`. |
| UI consistency | Pass | `ProgressTopBar` remains the single progress surface. |
| Undo contract | Watch | Server-side bulk mutations must preserve command audit logs; bulk undo coalescing is module-specific. |
| Testability | Pass | Unit and integration coverage points are explicit. |

## Changelog

| Date | Change |
|------|--------|
| 2026-05-13 | Created framework spec to make progress mandatory for bulk and future long-running operations. |
