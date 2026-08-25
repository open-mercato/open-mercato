export const DEFAULT_CHECKPOINT_INTERVAL = 20

export type BulkCreateCheckpoint<TFailure> = {
  lastCompletedRowIndex: number
  createdCount: number
  createdIds: string[]
  failedItems: TFailure[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    createdIds: [],
    failedItems: [],
  }
  if (!isRecord(meta)) return empty

  const lastCompletedRowIndex = typeof meta.lastCompletedRowIndex === 'number' && Number.isInteger(meta.lastCompletedRowIndex)
    ? meta.lastCompletedRowIndex
    : -1
  if (lastCompletedRowIndex < 0) return empty

  const summary = isRecord(meta.checkpointSummary) ? meta.checkpointSummary : null
  if (!summary) return { ...empty, lastCompletedRowIndex }

  const createdIds = Array.isArray(summary.createdIds)
    ? summary.createdIds.filter((value): value is string => typeof value === 'string')
    : []
  const failedItems = Array.isArray(summary.failedItems)
    ? (summary.failedItems.filter(isRecord) as TFailure[])
    : []
  const createdCount = typeof summary.createdCount === 'number' && Number.isInteger(summary.createdCount)
    ? summary.createdCount
    : createdIds.length

  return { lastCompletedRowIndex, createdCount, createdIds, failedItems }
}
