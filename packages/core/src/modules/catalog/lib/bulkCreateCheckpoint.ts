export const DEFAULT_CHECKPOINT_INTERVAL = 20

/**
 * Upper bound on the failure detail carried in `ProgressJob.meta`. `meta` is rewritten on every
 * checkpoint and is part of every broadcast job payload, so an uncapped list would grow the
 * persisted row (and the SSE frame every subscribed progress bar receives) with the batch.
 * `checkpointSummary.failedCount` stays exact regardless of the cap.
 */
export const MAX_CHECKPOINTED_FAILURES = 200

export type BulkCreateCheckpoint<TFailure> = {
  lastCompletedRowIndex: number
  createdCount: number
  failedCount: number
  createdIds: string[]
  failedItems: TFailure[]
  /**
   * The natural keys that already existed in the database when this job's first attempt started,
   * or `null` for a job checkpointed before this field existed. A resumed attempt uses it to tell
   * a record a previous attempt of this job created from one that was there all along; without it
   * no such classification is possible and every existing key is treated as a genuine conflict.
   */
  priorNaturalKeys: Set<string> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function readCheckpointInterval(meta: Record<string, unknown> | null | undefined): number {
  const raw = isRecord(meta) ? meta.checkpointInterval : undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return DEFAULT_CHECKPOINT_INTERVAL
  return raw
}

/**
 * Restores the accumulated batch state a previous attempt persisted, so a resumed run reports
 * a summary covering the whole batch instead of only the rows after the checkpoint. Every field
 * is validated independently: a job whose meta predates this shape, or was hand-edited, resumes
 * from whatever it can prove rather than throwing.
 */
export function readCheckpoint<TFailure>(
  meta: Record<string, unknown> | null | undefined,
): BulkCreateCheckpoint<TFailure> {
  const empty: BulkCreateCheckpoint<TFailure> = {
    lastCompletedRowIndex: -1,
    createdCount: 0,
    failedCount: 0,
    createdIds: [],
    failedItems: [],
    priorNaturalKeys: null,
  }
  if (!isRecord(meta)) return empty

  const priorNaturalKeys = Array.isArray(meta.priorNaturalKeys)
    ? new Set(readStringArray(meta.priorNaturalKeys))
    : null

  const lastCompletedRowIndex = typeof meta.lastCompletedRowIndex === 'number' && Number.isInteger(meta.lastCompletedRowIndex)
    ? meta.lastCompletedRowIndex
    : -1
  if (lastCompletedRowIndex < 0) return { ...empty, priorNaturalKeys }

  const summary = isRecord(meta.checkpointSummary) ? meta.checkpointSummary : null
  if (!summary) return { ...empty, lastCompletedRowIndex, priorNaturalKeys }

  // `createdIds` is no longer checkpointed (it grew with the batch and was rewritten on every
  // checkpoint), but a job enqueued before that change can still be mid-flight, so keep reading it.
  const createdIds = readStringArray(summary.createdIds)
  const failedItems = Array.isArray(summary.failedItems)
    ? (summary.failedItems.filter(isRecord) as TFailure[])
    : []
  const createdCount = typeof summary.createdCount === 'number' && Number.isInteger(summary.createdCount)
    ? summary.createdCount
    : createdIds.length
  const failedCount = typeof summary.failedCount === 'number' && Number.isInteger(summary.failedCount)
    ? summary.failedCount
    : failedItems.length

  return { lastCompletedRowIndex, createdCount, failedCount, createdIds, failedItems, priorNaturalKeys }
}

export type ResumeIndex = {
  priorNaturalKeys: ReadonlySet<string> | null
  existingKeyIds: ReadonlyMap<string, string>
  firstRowIndexByKey: ReadonlyMap<string, number>
}

/**
 * Maps each natural key to the first row in the batch that carries it, so a resumed attempt can
 * tell the row that created a record from a later row that merely repeats its key.
 */
export function buildFirstRowIndexByKey<TRow>(
  items: readonly TRow[],
  naturalKeyOf: (row: TRow) => string | null,
): Map<string, number> {
  const firstRowIndexByKey = new Map<string, number>()
  items.forEach((item, index) => {
    const key = naturalKeyOf(item)
    if (key !== null && !firstRowIndexByKey.has(key)) firstRowIndexByKey.set(key, index)
  })
  return firstRowIndexByKey
}

/**
 * Returns the id of the record a previous attempt of this job created for `rowIndex`, or `null`
 * when nothing can be proven and the row must go through the normal creation path.
 *
 * The classification is deliberately conservative — it never infers one row's outcome from
 * another's, because a row that failed mid-batch leaves nothing behind and would poison any
 * ordering assumption:
 *
 * - Only a resumed attempt reclaims rows at all. The signal is the presence of the key snapshot
 *   the first attempt recorded, not the checkpoint cursor: an attempt can persist the snapshot
 *   and then die before any checkpoint lands, and the rows it created in between still have to be
 *   reclaimable.
 * - Only a genuinely unique natural key counts. A row identified by title or name could match an
 *   unrelated record, and skipping it would drop it from the batch entirely.
 * - A key that already existed before the first attempt is somebody else's record: the row is a
 *   real conflict and must be reported as one rather than counted as created.
 * - Only the first row carrying a key can claim the record; a later row repeating it is an
 *   intra-batch duplicate and belongs in the conflict path.
 */
export function findRecordCreatedByPreviousAttempt(
  index: ResumeIndex,
  rowIndex: number,
  naturalKey: string | null,
): string | null {
  if (naturalKey === null || index.priorNaturalKeys === null) return null
  if (index.priorNaturalKeys.has(naturalKey)) return null
  if (index.firstRowIndexByKey.get(naturalKey) !== rowIndex) return null
  return index.existingKeyIds.get(naturalKey) ?? null
}
