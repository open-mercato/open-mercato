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
 */
export async function softDeleteSegmentsForEntry(
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
      deletedAt: null,
    },
    {},
    scope,
  )

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
