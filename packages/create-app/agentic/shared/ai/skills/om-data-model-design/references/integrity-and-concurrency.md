# Integrity and Concurrency

Load this reference for writes, locking, retries, and relation synchronization.

- Dispatch domain writes through commands. Capture before/after state needed by audit and undo. In `undo`, read the stored payload with `extractUndoPayload` from `@open-mercato/shared/lib/commands/undo`, re-authorize and re-scope the reversal, make retries safe, and restore the matching cache/event/index aliases. For custom fields import `buildCustomFieldResetMap` from `@open-mercato/shared/lib/commands/customFieldSnapshots`, compare the captured before/after maps, and persist its reset map on undo.
- Type each object as `CommandHandler<Input, Result>`, implement `undo: async ({ logEntry, ctx }) => { ... }`, then call `registerCommand(command)` separately; `registerCommand` returns no command object. Call `extractUndoPayload<UndoPayload>(logEntry)`. Enforce a lock with the single options object `enforceCommandOptimisticLock({ resourceKind, resourceId, current, expected, request: ctx.request })`, not positional timestamps.
- Import `withAtomicFlush` from `@open-mercato/shared/lib/commands/flush` and call `withAtomicFlush(em, [() => mutate(), () => syncRelations()], { transaction: true })`: the second argument is an array of zero-argument phases that close over the same `EntityManager`, not one callback receiving an `em`. Keep notifications, queues, external calls, cache invalidation, and indexing after commit, with durable compensation/recovery when those side effects can fail. Import `emitCrudSideEffects`/`emitCrudUndoSideEffects` from `@open-mercato/shared/lib/commands/helpers` and pass their documented options object (`dataEngine`, action, entity, scoped identifiers, events/indexer), not a runtime context plus invented effects descriptor.
- CRUD effects use past-tense `action: 'created' | 'updated' | 'deleted'` and `identifiers: { id, tenantId, organizationId }`. Define `CrudEventsConfig` as `{ module, entity, persistent?, buildPayload? }` and `CrudIndexerConfig` as `{ entityType, cacheAliases? }`; do not put `eventId` or loose scope fields in an effect call.
- Give every external/queued retry a stable idempotency key and scoped uniqueness boundary.
- Return `updatedAt` for editable records. Let `CrudForm` send the version; custom clients build the lock header and surface 409 conflicts.
- Guard custom action/sub-resource writes at command level, normally against the aggregate parent version, with `enforceCommandOptimisticLock` from `@open-mercato/shared/lib/crud/optimistic-lock-command` (or its documented injectable guard service).
- If a parent form mutates children, send each child's own version.
- Persist external cursor/mapping/progress state only after the batch commits; never mark forward progress on transient failure.

Tests must inject rollback between phases, race two updates, retry one operation twice, clear a nullable value, and verify side effects occur exactly after commit.
