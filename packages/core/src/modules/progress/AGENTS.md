# Progress Module — Agent Guidelines

Use the progress module for every user-visible bulk operation and every long-running operation. Keep `ProgressTopBar` the single shared progress surface.

## MUST Rules

1. **MUST create `ProgressJob` for durable work** — imports, exports, bulk mutations, reindexing, external sync, and queued work must persist progress server-side.
2. **MUST return `progressJobId` to the UI** — DataTable bulk actions and start-operation APIs must expose the job id so the top bar can track it.
3. **MUST update terminal status** — every job must reach `completed`, `failed`, or `cancelled`; never leave running jobs without heartbeat/progress updates.
4. **MUST scope by tenant and organization** — create, read, update, cancel, and worker payloads must carry `tenantId` and `organizationId`.
5. **MUST use queue workers for durable work** — use `@open-mercato/queue`; do not implement custom queues, timers, or page polling loops.
6. **MUST run mutations through commands** — workers must use `commandBus.execute(...)` for domain writes so audit, undo, cache, events, and index invalidation stay intact.
7. **MUST use client-local progress only for browser-bound loops** — local `client:*` progress events are best-effort and must not represent work that should survive navigation.
8. **MUST NOT build per-module progress bars for global operations** — use `ProgressTopBar` and shared progress hooks.

## Choosing Progress Mode

| When to use | Progress mode |
|-------------|---------------|
| Bulk delete/update/create, import/export, reindexing, external sync, report generation, long AI/tool execution | Server `ProgressJob` + queue worker |
| DataTable selected-row loop that must keep response-side metadata in the browser and completes in-page | Shared client-local progress events |
| Single-row CRUD action that normally completes quickly | Button/loading state + audit `LastOperationBanner`; no `ProgressJob` by default |
| Cancellable background operation | Server `ProgressJob` with `cancellable: true` and worker checks via `isCancellationRequested()` |

## Adding a Server-Side Bulk Operation

1. Create an API route that validates input with Zod and requires the module manage feature.
2. Resolve `progressService` from DI and call `createJob({ jobType, name, description, totalCount, cancellable, meta }, scope)`.
3. Enqueue a worker payload containing `progressJobId`, ids/filter criteria, and trusted `{ tenantId, organizationId, userId }` scope.
4. Return `202` with `{ ok: true, progressJobId, message }`.
5. In the worker, call `startJob`, process records through `commandBus.execute(...)`, update progress after each item or batch, and call `completeJob`.
6. Catch failures, call `failJob`, then rethrow so queue retry/error handling remains truthful.
7. Run `yarn generate` after adding worker files and test with the queue strategy used by the target environment.

## Adding a DataTable Bulk Action

1. Prefer an injected `:bulk-actions` widget for cross-module bulk actions; use the `bulkActions` prop only for host-owned actions.
2. For server-side work, call the start API and return `{ ok: true, progressJobId }` from `onExecute`.
3. For browser-bound loops, call shared UI bulk helpers with progress metadata; never maintain custom page-local progress state.
4. Keep destructive confirmation in the action before starting work.
5. Clear selection only after work starts or finishes through the DataTable bulk action contract.
6. Add unit coverage for progress emission or `progressJobId` handling.

## Job Type Naming

Use stable, grep-friendly ids:

| Operation | Job type |
|-----------|----------|
| Catalog product bulk delete | `catalog.products.bulk_delete` |
| Customer people bulk delete | `customers.people.bulk_delete` |
| Customer companies bulk delete | `customers.companies.bulk_delete` |
| Customer deals bulk delete | `customers.deals.bulk_delete` |
| Future operations | `<module>.<surface_or_resource>.<operation>` |

## Reference Files

| When you need | Copy from |
|---------------|-----------|
| Server-side progress start API | `packages/core/src/modules/catalog/api/bulk-delete/route.ts` |
| Worker progress lifecycle | `packages/core/src/modules/catalog/workers/catalog-product-bulk-delete.ts` |
| Command-driven bulk mutation with progress | `packages/core/src/modules/catalog/lib/bulkDelete.ts` |
| Client-local progress fallback | `packages/ui/src/backend/utils/bulkDelete.ts` |
| DataTable progress result handling | `packages/ui/src/backend/DataTable.tsx` |
| Progress UI merge/polling | `packages/ui/src/backend/progress/useProgressPoll.ts` and `useProgressSse.ts` |

## Cross-References

- **Queue worker rules**: `packages/queue/AGENTS.md`
- **DataTable bulk actions**: `packages/ui/AGENTS.md` → DataTable Guidelines
- **DOM Event Bridge**: `packages/events/AGENTS.md` → DOM Event Bridge
- **Framework spec**: `.ai/specs/2026-05-13-operation-progress-framework.md`
