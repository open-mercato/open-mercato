import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingMessageSend } from '../data/entities.js'
import { CAP_CONSUMING_SEND_STATUSES } from './runs.js'
import type { RunScope } from './runs.js'

/**
 * How long a reservation nobody settled stays in the way.
 *
 * A worker that dies between reserving a slot and hearing back from the transport leaves the row `reserved`,
 * and it counts against the cap — so without an expiry a crash would cost that person a slot for ever. The
 * lease matches the run claim's, because the two describe the same thing: how long this module waits before
 * deciding a worker is gone.
 */
export const SEND_RESERVATION_LEASE_MINUTES = 15

export type FrequencyCapWindow = {
  maxMessages: number
  windowHours: number
  /** Which cap this is, so a refusal can be recorded with the reason the reporting already uses. */
  reason: 'frequency_cap' | 'preference_cap'
}

export type SendSlotOutcome =
  | { reserved: true; id: string }
  | { reserved: false; reason: FrequencyCapWindow['reason'] }

/**
 * Takes a slot for one message, or refuses because a cap is full.
 *
 * The decision and the slot are ONE act, which is the whole point. The caps used to be check-then-send:
 * count what this subject has had, decide, then hand the message to the transport. Three workers running
 * three campaigns for the same person all counted the same number and all sent, so "at most two a week"
 * delivered four — and the customer-facing promise in the preference centre was the thing that broke.
 *
 * Serialised with a transaction-scoped advisory lock on the subject. Two fast statements inside it, and the
 * transport call deliberately OUTSIDE: a lock held across SMTP would let one slow provider stall every
 * campaign for that person, which is a worse failure than the one being fixed.
 *
 * Several caps are decided together rather than one reservation each. The campaign's cap and the recipient's
 * own are evaluated in their own windows — merging them would mean normalising two windows into one and
 * getting a number from neither — but they have to be decided under the same lock, or a slot taken for one
 * is invisible to the other.
 */
export async function reserveSendSlot(
  em: EntityManager,
  input: {
    scope: RunScope
    subjectEntityId: string
    campaignId: string
    runId: string
    stepId: string
    channel: 'email' | 'sms' | 'push'
    caps: FrequencyCapWindow[]
    now: Date
  },
): Promise<SendSlotOutcome> {
  return em.transactional(async (tx) => {
    /**
     * `hashtext` of the scoped subject, as a transaction lock.
     *
     * A collision between two unrelated subjects costs one of them a brief wait and nothing else, so the
     * hash needs no uniqueness. The lock is released by the commit, so there is no path where it leaks.
     */
    await tx.execute('select pg_advisory_xact_lock(hashtext(?)::bigint)', [
      `marketing:send-slot:${input.scope.tenantId}:${input.scope.organizationId}:${input.subjectEntityId}`,
    ])

    for (const cap of input.caps) {
      const since = new Date(input.now.getTime() - cap.windowHours * 3_600_000)
      const taken = await tx.count(MarketingMessageSend, {
        subjectEntityId: input.subjectEntityId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        status: { $in: [...CAP_CONSUMING_SEND_STATUSES] },
        sentAt: { $gte: since },
      })
      if (taken >= cap.maxMessages) return { reserved: false, reason: cap.reason }
    }

    const reservation = tx.create(MarketingMessageSend, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      campaignId: input.campaignId,
      runId: input.runId,
      stepId: input.stepId,
      subjectEntityId: input.subjectEntityId,
      channel: input.channel,
      status: 'reserved',
      suppressionReason: null,
      // The reservation instant, which is also what every cap window filters on.
      sentAt: input.now,
    })
    tx.persist(reservation)
    await tx.flush()
    return { reserved: true, id: reservation.id }
  })
}

/** Turns a taken slot into what actually happened. */
export async function settleSendSlot(
  em: EntityManager,
  scope: RunScope,
  id: string,
  status: 'sent' | 'failed',
): Promise<void> {
  await em.nativeUpdate(
    MarketingMessageSend,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'reserved' },
    { status },
  )
}

/**
 * Gives a slot back when nothing was sent.
 *
 * Deleted rather than marked: a step that skipped for a reason of its own — no address on the subject —
 * produced no message, and a `failed` row there would tell the deliverability guardrail the transport had
 * rejected something it never saw.
 */
export async function releaseSendSlot(em: EntityManager, scope: RunScope, id: string): Promise<void> {
  await em.nativeDelete(MarketingMessageSend, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'reserved',
  })
}

/**
 * Frees slots whose worker never came back.
 *
 * Deleted for the same reason a release is: nothing went out, so nothing should appear in the delivery
 * figures. The loss is that a crashed send is invisible there — but the run it belongs to is `failed` or
 * dead-lettered and says so, and inventing a `failed` message for one that may well have been delivered
 * would be worse than either.
 */
export async function expireStaleSendReservations(
  em: EntityManager,
  scope: RunScope,
  now: Date,
  leaseMinutes = SEND_RESERVATION_LEASE_MINUTES,
): Promise<number> {
  return em.nativeDelete(MarketingMessageSend, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'reserved',
    sentAt: { $lt: new Date(now.getTime() - leaseMinutes * 60_000) },
  })
}
