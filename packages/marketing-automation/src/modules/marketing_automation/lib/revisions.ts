import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaignRevision, MarketingCampaignTrigger } from '../data/entities.js'

/**
 * Campaign history: an audit trail and a set of versions to go back to, from one table.
 *
 * Recorded AFTER each successful save, so version 1 is the first save rather than a gap, and a restore is
 * an ordinary save that happens to carry old content — which means it is validated, locked and audited by
 * exactly the same code as any other edit.
 */

export type RevisionScope = { tenantId: string; organizationId: string }

/**
 * How many versions to keep per campaign.
 *
 * Enough to cover the useful case — "put back what it was this morning" — without turning an
 * often-edited campaign into an unbounded pile of jsonb. The oldest are pruned on write rather than by a
 * job, because a job that does not run leaves the table growing and nobody notices.
 */
export const MAX_REVISIONS_PER_CAMPAIGN = 30

export type RevisionNote = 'saved' | `restored:${number}`

type RevisionInput = {
  campaignId: string
  name: string
  definition: Record<string, unknown>
  actorId?: string | null
  note: RevisionNote
}

function serializeTriggers(triggers: MarketingCampaignTrigger[]): unknown[] {
  return triggers.map((trigger) => (trigger.kind === 'schedule'
    ? {
        kind: 'schedule' as const,
        scheduleValue: trigger.scheduleValue ?? null,
        reentryAfterDays: trigger.reentryAfterDays ?? null,
        sweepSource: trigger.sweepSource ?? null,
        sweepParams: trigger.sweepParams ?? null,
      }
    : { kind: 'event' as const, eventId: trigger.eventId ?? null }))
}

/**
 * Writes the revision for a save that has already committed.
 *
 * Never throws into the caller: a save that succeeded must not be reported as failed because its history
 * entry could not be written. The consequence of a lost revision is a gap in a list; the consequence of a
 * rolled-back save is an author's work.
 */
export async function recordRevision(
  em: EntityManager,
  scope: RevisionScope,
  input: RevisionInput,
  onError?: (error: unknown) => void,
): Promise<number | null> {
  try {
    const triggers = await em.find(MarketingCampaignTrigger, { campaignId: input.campaignId, ...scope })

    const latest = await em.find(
      MarketingCampaignRevision,
      { campaignId: input.campaignId, ...scope },
      { orderBy: { version: 'DESC' }, limit: 1 },
    )
    const version = (latest[0]?.version ?? 0) + 1

    const revision = em.create(MarketingCampaignRevision, {
      ...scope,
      campaignId: input.campaignId,
      version,
      name: input.name,
      definition: input.definition,
      triggers: serializeTriggers(triggers),
      actorId: input.actorId ?? null,
      note: input.note,
    })
    em.persist(revision)

    // Pruned in the same flush, so the cap holds even if nothing else ever runs.
    const surplus = await em.find(
      MarketingCampaignRevision,
      { campaignId: input.campaignId, ...scope },
      { orderBy: { version: 'DESC' }, offset: MAX_REVISIONS_PER_CAMPAIGN - 1 },
    )
    for (const old of surplus) em.remove(old)

    await em.flush()
    return version
  } catch (error) {
    onError?.(error)
    return null
  }
}

export type RevisionSummary = {
  version: number
  name: string
  note: string
  actorId: string | null
  createdAt: string
  stepCount: number
  triggerCount: number
}

function countSteps(definition: unknown): number {
  if (!definition || typeof definition !== 'object') return 0
  const steps = (definition as { steps?: unknown }).steps
  return Array.isArray(steps) ? steps.length : 0
}

export async function listRevisions(
  em: EntityManager,
  scope: RevisionScope,
  campaignId: string,
  limit = MAX_REVISIONS_PER_CAMPAIGN,
): Promise<RevisionSummary[]> {
  const rows = await em.find(
    MarketingCampaignRevision,
    { campaignId, ...scope },
    { orderBy: { version: 'DESC' }, limit },
  )
  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    note: row.note,
    actorId: row.actorId ?? null,
    createdAt: row.createdAt.toISOString(),
    // Counted here rather than in the browser: a list of thirty definitions is a lot of jsonb to ship so a
    // screen can print two numbers.
    stepCount: countSteps(row.definition),
    triggerCount: Array.isArray(row.triggers) ? row.triggers.length : 0,
  }))
}

export async function readRevision(
  em: EntityManager,
  scope: RevisionScope,
  campaignId: string,
  version: number,
): Promise<MarketingCampaignRevision | null> {
  return em.findOne(MarketingCampaignRevision, { campaignId, version, ...scope })
}
