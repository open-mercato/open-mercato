import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTimeEntrySegment } from '../../data/entities'

export type TimeEntrySegmentCascadeScope = {
  tenantId: string
  organizationId: string
}

/**
 * Soft-deleting a `StaffTimeEntry` has to take its work segments with it, or the
 * segments keep `deleted_at = NULL` while pointing at a deleted parent — and any
 * consumer that aggregates segments directly (reporting, duration recomputation,
 * exports) reads rows whose entry no longer exists.
 *
 * The `deletedAt` instant is supplied by the caller rather than taken here, so the
 * entry and every segment it owns share one timestamp. That shared instant is the
 * restore key: `restoreSegmentsForEntry` matches on it, which is what stops an undo
 * from resurrecting a segment the user had deleted individually beforehand, since
 * such a row carries a different timestamp.
 *
 * Neither function flushes — both participate in the caller's transaction, so the
 * entry and its segments commit or roll back together.
 *
 * Both functions query before they mutate, so callers MUST invoke them before
 * dirtying any entity on the same `EntityManager` — including the entry itself.
 * A query issued while scalar changes are pending can drop them silently
 * (`packages/core/AGENTS.md` → `withAtomicFlush`; SPEC-018). Set the entry's own
 * `deletedAt` after the cascade returns, not before.
 */
export async function softDeleteSegmentsForEntry(
  em: EntityManager,
  timeEntryId: string,
  scope: TimeEntrySegmentCascadeScope,
  deletedAt: Date,
): Promise<number> {
  const segmentsByEntry = await findLiveSegmentsForEntries(em, [timeEntryId], scope)
  return markSegmentsDeleted(segmentsByEntry.get(timeEntryId) ?? [], deletedAt)
}

/**
 * The read half of `softDeleteSegmentsForEntry`, for callers that soft-delete
 * several entries in one pass: load every entry's live segments with one query
 * up front, then mark each set with `markSegmentsDeleted` — no query runs after
 * the first mutation.
 */
export async function findLiveSegmentsForEntries(
  em: EntityManager,
  timeEntryIds: string[],
  scope: TimeEntrySegmentCascadeScope,
): Promise<Map<string, StaffTimeEntrySegment[]>> {
  const segmentsByEntry = new Map<string, StaffTimeEntrySegment[]>()
  if (timeEntryIds.length === 0) return segmentsByEntry

  const segments = await findWithDecryption(
    em,
    StaffTimeEntrySegment,
    {
      timeEntryId: timeEntryIds.length === 1 ? timeEntryIds[0] : { $in: timeEntryIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )

  for (const segment of segments) {
    const bucket = segmentsByEntry.get(segment.timeEntryId)
    if (bucket) bucket.push(segment)
    else segmentsByEntry.set(segment.timeEntryId, [segment])
  }
  return segmentsByEntry
}

/** The write half of `softDeleteSegmentsForEntry`; pure, never queries. */
export function markSegmentsDeleted(segments: StaffTimeEntrySegment[], deletedAt: Date): number {
  for (const segment of segments) {
    // An open segment left behind reads as work still running against an entry
    // that no longer exists; closing it at the delete instant removes that shape.
    if (!segment.endedAt) segment.endedAt = deletedAt
    segment.deletedAt = deletedAt
  }
  return segments.length
}

/**
 * Reverses `softDeleteSegmentsForEntry` for exactly the set it removed, identified
 * by the shared `deletedAt` instant recorded in the undo payload. A segment closed
 * by the cascade (`endedAt === deletedAt`) is re-opened; one that was already closed
 * before the cascade keeps its own `endedAt`.
 *
 * Re-opening infers "the cascade closed this" from `endedAt === deletedAt`, so a
 * segment legitimately closed in the very same millisecond as the delete would be
 * re-opened too. Two HTTP requests landing on the same millisecond makes that
 * vanishingly unlikely, and the `deletedAt` half of the key is unaffected; recording
 * the closed ids in the undo payload is the exact-rather-than-probabilistic fix if it
 * ever matters.
 */
export async function restoreSegmentsForEntry(
  em: EntityManager,
  timeEntryId: string,
  scope: TimeEntrySegmentCascadeScope,
  deletedAt: Date,
): Promise<number> {
  const segments = await findWithDecryption(
    em,
    StaffTimeEntrySegment,
    {
      timeEntryId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt,
    },
    {},
    scope,
  )

  for (const segment of segments) {
    if (segment.endedAt && segment.endedAt.getTime() === deletedAt.getTime()) {
      segment.endedAt = null
    }
    segment.deletedAt = null
  }

  return segments.length
}
