import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingSegmentSnapshot } from '../data/entities.js'
import { loadSegmentDefinitions } from './segments.js'
import { resolveSegmentMembers, SCREEN_MAX_CHECKED } from './segment-members.js'
import type { SubjectDocument } from './engine/types.js'
import type { MemberScope } from './segment-members.js'

/**
 * The daily size of each segment.
 *
 * Taken by the sweep pass rather than by a job of its own, for the reason every other piece of housekeeping in
 * this module is: a task that needs its own schedule is a task that will not be scheduled somewhere.
 */

/** `YYYY-MM-DD` in UTC. One row per segment per day, and the index enforces it. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** How many days of history to keep. A quarter is enough to see a trend and to compare with last month. */
export const SNAPSHOT_RETENTION_DAYS = 120

export type SnapshotOutcome = { taken: number; skipped: number }

/**
 * Records today's size for every segment that does not have one yet.
 *
 * Idempotent by construction: the unique index on (tenant, org, segment, day) means a second pass on the same
 * day inserts nothing, so this can run on every sweep tick without a "have I already done this" flag to get
 * wrong.
 *
 * Bounded by `SCREEN_MAX_CHECKED` rather than the larger job ceiling, deliberately: this runs for every
 * segment on every tick, and a chart is worth a bounded number, not an unbounded scan. Each point records
 * whether it was exact.
 */
export async function takeSegmentSnapshots(
  em: EntityManager,
  container: AwilixContainer,
  scope: MemberScope,
  now: Date,
): Promise<SnapshotOutcome> {
  const definitions = await loadSegmentDefinitions(em, scope)
  if (definitions.length === 0) return { taken: 0, skipped: 0 }

  const day = dayKey(now)
  const existing = await em.find(MarketingSegmentSnapshot, { ...scope, day })
  const done = new Set(existing.map((row) => row.segmentId))

  let taken = 0
  let skipped = 0

  /**
   * One cache for the whole pass, and the reason it is here rather than inside the resolver.
   *
   * Every segment is resolved over the same population on the same tick. A segment whose expression narrows
   * in SQL never builds a document at all and is unaffected; one that cannot narrow describes each candidate
   * in eleven queries, and without this the second such segment describes exactly the same people again.
   * Dropped when this function returns, so nothing here can answer a later tick with a stale customer.
   */
  const documents = new Map<string, SubjectDocument>()

  for (const definition of definitions) {
    if (done.has(definition.id)) {
      skipped += 1
      continue
    }
    try {
      const resolution = await resolveSegmentMembers(
        em,
        container,
        scope,
        definition.expression as ConditionExpression | null,
        { maxChecked: SCREEN_MAX_CHECKED, now, documents },
      )
      const snapshot = em.create(MarketingSegmentSnapshot, {
        ...scope,
        segmentId: definition.id,
        day,
        size: resolution.ids.length,
        qualifier: resolution.complete ? 'exact' : 'sample',
      })
      em.persist(snapshot)
      await em.flush()
      taken += 1
    } catch {
      // One segment's snapshot is never worth failing the sweep for; the missing point is visible as a gap.
      em.clear()
      skipped += 1
    }
  }

  return { taken, skipped }
}

/** Drops points past the retention window, on the same pass that writes them. */
export async function pruneSegmentSnapshots(
  em: EntityManager,
  scope: MemberScope,
  now: Date,
  retentionDays = SNAPSHOT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = dayKey(new Date(now.getTime() - retentionDays * 86_400_000))
  return em.nativeDelete(MarketingSegmentSnapshot, { ...scope, day: { $lt: cutoff } })
}
