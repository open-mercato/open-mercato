import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingInboundRequest } from '../data/entities.js'

/**
 * The same three words the hook row already carries in `last_outcome`.
 *
 * Reused rather than invented: the hook list and this log describe the same request, and two vocabularies for
 * one fact is how two screens end up disagreeing about what happened.
 */
export type InboundRequestOutcome =
  | 'identified'
  | 'no matching customer'
  | 'no customerId or email in the payload'

export type InboundRequestScope = { tenantId: string; organizationId: string }

/**
 * How long a logged request is kept.
 *
 * Seven days, where the job log and the dead letters get thirty. Those two are redacted on write, so what ages
 * out of them is already a record rather than somebody's data; this one holds a partner's body verbatim,
 * addresses included. The window is therefore set by how long a debugging question stays worth answering —
 * about a week — rather than by what the other logs happen to use.
 */
export const INBOUND_REQUEST_RETENTION_DAYS = 7

/**
 * Writes one row per request that got past the signature check.
 *
 * Never throws. The endpoint it is called from is public and answers 202 to every verified caller, so a
 * logging failure must not become a delivery failure — a partner would retry a request that was in fact
 * accepted, and the campaign would run twice.
 */
export async function recordInboundRequest(
  em: EntityManager,
  scope: InboundRequestScope,
  entry: {
    hookId: string
    subjectEntityId?: string | null
    outcome: InboundRequestOutcome
    body?: Record<string, unknown> | null
    bodyBytes: number
  },
): Promise<void> {
  const row = em.create(MarketingInboundRequest, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    hookId: entry.hookId,
    subjectEntityId: entry.subjectEntityId ?? null,
    outcome: entry.outcome,
    body: entry.body ?? null,
    bodyBytes: entry.bodyBytes,
  })
  em.persist(row)
  await em.flush()
}

/**
 * Removes logged requests past the retention window.
 *
 * Pruned by the sweep that the other two logs are pruned by, for the reason they are: a cleanup task nobody
 * scheduled is a table that grows until somebody notices. This one matters more than the others, because what
 * accumulates here is other people's data rather than our own counters.
 */
export async function pruneInboundRequests(
  em: EntityManager,
  scope: InboundRequestScope,
  now: Date,
  retentionDays = INBOUND_REQUEST_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
  return em.nativeDelete(MarketingInboundRequest, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    receivedAt: { $lt: cutoff },
  })
}
