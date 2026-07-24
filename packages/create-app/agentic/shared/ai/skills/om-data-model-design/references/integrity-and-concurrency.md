# Integrity and Concurrency

Load this reference for writes, locking, retries, and relation synchronization.

- Dispatch domain writes through commands. Capture before/after state needed by audit and undo.
- Use `withAtomicFlush` with a transaction for multi-phase scalar plus relation/custom-field work. Keep side effects after commit.
- Give every external/queued retry a stable idempotency key and scoped uniqueness boundary.
- Return `updatedAt` for editable records. Let `CrudForm` send the version; custom clients build the lock header and surface 409 conflicts.
- Guard custom action/sub-resource writes at command level, normally against the aggregate parent version.
- If a parent form mutates children, send each child's own version.
- Persist external cursor/mapping/progress state only after the batch commits; never mark forward progress on transient failure.

Tests must inject rollback between phases, race two updates, retry one operation twice, clear a nullable value, and verify side effects occur exactly after commit.
