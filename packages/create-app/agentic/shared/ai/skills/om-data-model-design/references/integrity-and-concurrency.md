# Integrity and Concurrency

Load this reference for writes, locking, retries, and relation synchronization.

- Dispatch domain writes through commands. Capture before/after state needed by audit and undo. In `undo`, read the stored payload with `extractUndoPayload` from `@open-mercato/shared/lib/commands/undo`, re-authorize and re-scope the reversal, make retries safe, and restore the matching cache/event/index aliases.
- Import `withAtomicFlush` from `@open-mercato/shared/lib/commands/flush` and pass `{ transaction: true }` for multi-phase scalar plus relation/custom-field work. It is atomic only when all phases use the same `EntityManager`; nesting commands that fork managers is not a cross-command transaction. Keep notifications, queues, external calls, cache invalidation, and indexing after commit, with durable compensation/recovery when those side effects can fail.
- Give every external/queued retry a stable idempotency key and scoped uniqueness boundary.
- Return `updatedAt` for editable records. Let `CrudForm` send the version; custom clients build the lock header and surface 409 conflicts.
- Guard custom action/sub-resource writes at command level, normally against the aggregate parent version, with `enforceCommandOptimisticLock` from `@open-mercato/shared/lib/crud/optimistic-lock-command` (or its documented injectable guard service).
- If a parent form mutates children, send each child's own version.
- Persist external cursor/mapping/progress state only after the batch commits; never mark forward progress on transient failure.

Tests must inject rollback between phases, race two updates, retry one operation twice, clear a nullable value, and verify side effects occur exactly after commit.
