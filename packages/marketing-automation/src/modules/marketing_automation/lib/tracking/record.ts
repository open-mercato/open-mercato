import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingMessageSend, MarketingMessageSendEvent } from '../../data/entities.js'
import type { TrackingClaims } from './token.js'

/** Author-authored URLs can be arbitrarily long; the column is for attribution, not for archival. */
const MAX_LINK_LENGTH = 2_000

export type TrackingEventType = MarketingMessageSendEvent['type']

/**
 * Records one delivery event.
 *
 * Runs on a PUBLIC request, so every value written comes from the signed token rather than from the
 * request: the scope especially, since an unauthenticated caller has none of its own.
 *
 * The send row is looked up rather than required. An open can arrive before the send row has been
 * committed — the orchestrator writes it after the step returns — and losing the event because of
 * that ordering would understate every campaign's results.
 */
export async function recordTrackingEvent(
  em: EntityManager,
  claims: TrackingClaims,
  input: { type: TrackingEventType; linkUrl?: string | null; now: Date },
): Promise<void> {
  const scope = { tenantId: claims.tenantId, organizationId: claims.organizationId }

  const send = await em.findOne(MarketingMessageSend, {
    ...scope,
    runId: claims.runId,
    stepId: claims.stepId,
  })

  /**
   * One OPEN per message, however many times the pixel is fetched.
   *
   * A tracking token never expires — it has to survive in a mail archive — so anybody holding one link can fetch
   * the pixel in a loop, and every fetch was a row in a table nothing prunes. The metrics were already immune
   * (they count distinct runs), which is precisely why the growth was invisible.
   *
   * Clicks stay append-only: a second click is a fact about behaviour, and the link clicked is part of it. An
   * open is not — a mail client re-rendering a message tells us nothing we did not already know.
   */
  if (input.type === 'opened') {
    const alreadyOpened = await em.findOne(MarketingMessageSendEvent, {
      ...scope,
      runId: claims.runId,
      stepId: claims.stepId,
      type: 'opened',
    })
    if (alreadyOpened) return
  }

  const event = em.create(MarketingMessageSendEvent, {
    ...scope,
    campaignId: claims.campaignId,
    runId: claims.runId,
    stepId: claims.stepId,
    sendId: send?.id ?? null,
    type: input.type,
    linkUrl: input.linkUrl ? input.linkUrl.slice(0, MAX_LINK_LENGTH) : null,
    occurredAt: input.now,
  })
  em.persist(event)
  await em.flush()
}
