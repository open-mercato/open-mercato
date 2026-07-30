/**
 * Queue names whose jobs resume an existing SyncRun instead of starting a fresh
 * one. The workers import these to declare their `metadata.queue`, so a rename
 * cannot silently drop the retry policy.
 */
export const DATA_SYNC_IMPORT_QUEUE = 'data-sync-import'
export const DATA_SYNC_EXPORT_QUEUE = 'data-sync-export'

export const DATA_SYNC_RESUMABLE_QUEUES: readonly string[] = [DATA_SYNC_IMPORT_QUEUE, DATA_SYNC_EXPORT_QUEUE]

export const DATA_SYNC_QUEUE_ATTEMPTS = 3

/**
 * A backfill batch can hold the processor well past BullMQ's 30s default lock,
 * so these jobs stall on slow upstreams even when the worker is perfectly
 * healthy. `DATA_SYNC_LOCK_DURATION_MS` is the primary defence — it stops most
 * of those false stalls at the source rather than reacting to them.
 *
 * `DATA_SYNC_MAX_STALLED_COUNT` covers what is left. BullMQ fails a job once it
 * stalls more than this many times, and at the default of 1 a single stall
 * during a long backfill discards the run permanently. 10 buys enough
 * redeliveries to survive a rolling restart. Raising it is only safe because a
 * duplicate delivery can no longer corrupt the run: the ownership
 * compare-and-swap in `commitBatchProgress` lets exactly one worker advance a
 * run, and every other delivery aborts on its first commit. A job that poisons its
 * worker still dies — after 10 stalls, with the run left `running` and its
 * cursor unmoved, which is the state the admin runs list surfaces.
 */
export const DATA_SYNC_LOCK_DURATION_MS = 120_000
export const DATA_SYNC_MAX_STALLED_COUNT = 10
