import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCustomerScoreEntry } from '../data/entities.js'
import type { SubjectScope } from './scope.js'

/**
 * Lead score: a signed points total per customer, stored as a ledger.
 *
 * The total is always derived, never cached. That keeps one source of truth and lets the set-level
 * narrowing answer `score.points >= 100` with the same aggregate the subject document uses, rather
 * than the two disagreeing the moment a write is missed.
 */

export type ScoreSource = MarketingCustomerScoreEntry['source']

export type ScoreEntryInput = {
  scope: SubjectScope
  subjectEntityId: string
  points: number
  reason?: string | null
  source: ScoreSource
  campaignId?: string | null
  /** Together these make the write idempotent; omit both for a manual adjustment. */
  runId?: string | null
  stepId?: string | null
  /** Only for `rule` entries: the position this entry claims in the subject's rule history. */
  ruleSequence?: number | null
  now: Date
}

export type ScoreEntryResult = {
  /** False when this (run, step) already awarded its points — a redelivery, not a failure. */
  applied: boolean
  previousPoints: number
  points: number
  /**
   * True when this entry's `score.changed` event still needs to go out.
   *
   * Set on a fresh insert, and recovered from the existing row on a collision: a retry whose earlier
   * attempt wrote the ledger but never confirmed the emit must still try again, while a plain
   * redelivery of an already-completed step must not re-emit. The ledger write and the emission are
   * two different facts, and only this field distinguishes them.
   */
  eventPending: boolean
  /** The ledger row's id, for `markScoreEventEmitted` once the caller's emit succeeds. Null only when
   *  a collision could not be traced back to a (run, step) row — a defensive case that should not
   *  arise, since only (run, step) writes can collide at all. */
  entryId: string | null
}

/** Records that this entry's event reached the bus, so a later retry does not emit it again. */
export async function markScoreEventEmitted(em: EntityManager, entryId: string, now: Date): Promise<void> {
  await em.nativeUpdate(MarketingCustomerScoreEntry, { id: entryId }, { eventEmittedAt: now })
}

export async function loadScorePoints(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<number> {
  const rows = await em.getConnection().execute<{ total: string | null }[]>(
    `select coalesce(sum(points), 0)::text as total
       from marketing_customer_score_entries
      where subject_entity_id = ? and tenant_id = ? and organization_id = ?`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  const total = Number.parseInt(rows[0]?.total ?? '0', 10)
  return Number.isFinite(total) ? total : 0
}

export type RuleScoreState = {
  /** What the score rules award this subject right now: the sum of its `rule` entries. */
  points: number
  /** How many `rule` entries exist, which is the sequence number the next one claims. */
  entries: number
}

export async function loadRuleScoreState(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
): Promise<RuleScoreState> {
  const rows = await em.getConnection().execute<{ total: string | null; entries: string | null }[]>(
    `select coalesce(sum(points), 0)::text as total, count(*)::text as entries
       from marketing_customer_score_entries
      where subject_entity_id = ? and tenant_id = ? and organization_id = ? and rule_sequence is not null`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  const points = Number.parseInt(rows[0]?.total ?? '0', 10)
  const entries = Number.parseInt(rows[0]?.entries ?? '0', 10)
  return { points: Number.isFinite(points) ? points : 0, entries: Number.isFinite(entries) ? entries : 0 }
}

/**
 * Records points once.
 *
 * Inserted on a FORK so a rejected insert cannot sit in the caller's persist stack, and the previous
 * total is read first so the emitted event can say what the score CROSSED — which is the only way an
 * audience can express "reached 100 points" rather than "is above 100 points", and therefore the only
 * way a campaign fires once instead of on every subsequent change.
 */
export async function addScoreEntry(em: EntityManager, input: ScoreEntryInput): Promise<ScoreEntryResult> {
  const previousPoints = await loadScorePoints(em, input.subjectEntityId, input.scope)

  const fork = em.fork()
  const entry = fork.create(MarketingCustomerScoreEntry, {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    subjectEntityId: input.subjectEntityId,
    points: input.points,
    reason: input.reason ?? null,
    source: input.source,
    campaignId: input.campaignId ?? null,
    runId: input.runId ?? null,
    stepId: input.stepId ?? null,
    ruleSequence: input.ruleSequence ?? null,
    occurredAt: input.now,
  })

  try {
    fork.persist(entry)
    await fork.flush()
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) {
      /**
       * `previousPoints` above already includes the row that just collided — it was written by an
       * earlier attempt, so `loadScorePoints` counted it before this insert was even tried. The
       * event's own "crossed" semantics need the total from BEFORE that row, which only the row
       * itself (its `points`) can subtract back out.
       */
      const existing = input.runId && input.stepId
        ? await em.findOne(MarketingCustomerScoreEntry, {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId,
            runId: input.runId,
            stepId: input.stepId,
          })
        : null
      return {
        applied: false,
        previousPoints: existing ? previousPoints - existing.points : previousPoints,
        points: previousPoints,
        eventPending: existing ? existing.eventEmittedAt == null : false,
        entryId: existing?.id ?? null,
      }
    }
    throw error
  }

  return {
    applied: true,
    previousPoints,
    points: previousPoints + input.points,
    eventPending: true,
    entryId: entry.id,
  }
}
