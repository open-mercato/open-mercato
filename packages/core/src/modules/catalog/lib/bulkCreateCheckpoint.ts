export const DEFAULT_CHECKPOINT_INTERVAL = 20

/**
 * Upper bound on the failure detail carried in `ProgressJob.meta`. `meta` is rewritten on every
 * checkpoint and is part of every broadcast job payload, so an uncapped list would grow the
 * persisted row (and the SSE frame every subscribed progress bar receives) with the batch.
 * `checkpointSummary.failedCount` stays exact regardless of the cap.
 */
export const MAX_CHECKPOINTED_FAILURES = 200

const BITS_PER_BYTE = 8

export type BulkCreateCheckpoint<TFailure> = {
  lastCompletedRowIndex: number
  createdCount: number
  failedCount: number
  createdIds: string[]
  failedItems: TFailure[]
  /**
   * The rows whose natural key already existed in the database when this job's first attempt
   * started, or `null` for a job checkpointed before this field existed. A resumed attempt uses it
   * to tell a record a previous attempt of this job created from one that was there all along;
   * without it no such classification is possible and every existing key is a genuine conflict.
   */
  priorKeyRows: ReadonlySet<number> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * Encodes the snapshot as a base64 bitset over row indices rather than the natural keys
 * themselves. `ProgressJob.meta` is rewritten on every checkpoint and rides every broadcast
 * frame, so the snapshot's size is paid ~`items.length / checkpointInterval` times over: a key
 * list costs the summed length of every conflicting key (hundreds of KB for a large re-import),
 * while one bit per row costs `items.length / 8` bytes whatever the keys look like. The snapshot
 * cannot be capped — a partial one would let a row claim a record it merely conflicts with — so
 * it is made small instead.
 */
export function encodePriorKeyRows(rowIndices: Iterable<number>, rowCount: number): string {
  const bytes = new Uint8Array(Math.ceil(Math.max(rowCount, 0) / BITS_PER_BYTE))
  for (const rowIndex of rowIndices) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount) continue
    bytes[Math.floor(rowIndex / BITS_PER_BYTE)] |= 1 << (rowIndex % BITS_PER_BYTE)
  }
  return Buffer.from(bytes).toString('base64')
}

export function decodePriorKeyRows(value: unknown): ReadonlySet<number> | null {
  if (typeof value !== 'string') return null
  const bytes = Buffer.from(value, 'base64')
  const rowIndices = new Set<number>()
  bytes.forEach((byte, byteIndex) => {
    for (let bit = 0; bit < BITS_PER_BYTE; bit += 1) {
      if (byte & (1 << bit)) rowIndices.add(byteIndex * BITS_PER_BYTE + bit)
    }
  })
  return rowIndices
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
    priorKeyRows: null,
  }
  if (!isRecord(meta)) return empty

  const priorKeyRows = decodePriorKeyRows(meta.priorKeyRows)

  const lastCompletedRowIndex = typeof meta.lastCompletedRowIndex === 'number' && Number.isInteger(meta.lastCompletedRowIndex)
    ? meta.lastCompletedRowIndex
    : -1
  if (lastCompletedRowIndex < 0) return { ...empty, priorKeyRows }

  const summary = isRecord(meta.checkpointSummary) ? meta.checkpointSummary : null
  if (!summary) return { ...empty, lastCompletedRowIndex, priorKeyRows }

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

  return { lastCompletedRowIndex, createdCount, failedCount, createdIds, failedItems, priorKeyRows }
}

export type ResumeIndex = {
  priorKeyRows: ReadonlySet<number> | null
  existingKeyIds: ReadonlyMap<string, string>
  firstRowIndexByKey: ReadonlyMap<string, number>
}

/**
 * Maps each natural key to the first row in the batch that carries it, so a resumed attempt can
 * tell the row that created a record from a later row that merely repeats its key. Every key a
 * row could be identified by is registered, not just the one it is reclaimed under: a record
 * created for a row's SKU is also reachable by that row's handle, and leaving the handle
 * unregistered would let a later handle-only row claim it.
 */
export function buildFirstRowIndexByKey<TRow>(
  items: readonly TRow[],
  naturalKeysOf: (row: TRow) => readonly string[],
): Map<string, number> {
  const firstRowIndexByKey = new Map<string, number>()
  items.forEach((item, index) => {
    for (const key of naturalKeysOf(item)) {
      if (!firstRowIndexByKey.has(key)) firstRowIndexByKey.set(key, index)
    }
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
 * - Only a resumed attempt reclaims rows at all. The signal is the presence of the snapshot the
 *   first attempt recorded, not the checkpoint cursor: an attempt can persist the snapshot and
 *   then die before any checkpoint lands, and the rows it created in between still have to be
 *   reclaimable.
 * - Only a genuinely unique natural key counts. A row identified by title or name could match an
 *   unrelated record, and skipping it would drop it from the batch entirely.
 * - A row whose key already existed before the first attempt points at somebody else's record: it
 *   is a real conflict and must be reported as one rather than counted as created.
 * - Only the first row carrying a key can claim the record; a later row repeating it is an
 *   intra-batch duplicate and belongs in the conflict path.
 * - A record an earlier row of this batch already claimed is never handed to a second row, so two
 *   rows can never both count the same id as their own creation.
 */
export function findRecordCreatedByPreviousAttempt(
  index: ResumeIndex,
  rowIndex: number,
  naturalKey: string | null,
  alreadyReclaimedIds: ReadonlySet<string>,
): string | null {
  if (naturalKey === null || index.priorKeyRows === null) return null
  if (index.priorKeyRows.has(rowIndex)) return null
  if (index.firstRowIndexByKey.get(naturalKey) !== rowIndex) return null
  const recordId = index.existingKeyIds.get(naturalKey)
  if (recordId === undefined || alreadyReclaimedIds.has(recordId)) return null
  return recordId
}
