import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingConsent, MarketingConsentEvent } from '../data/entities.js'
import type { SubjectScope } from './subject-document.js'

/**
 * Marketing consent: whether this customer wants messages on this channel.
 *
 * The gate is read on every send, so it is one indexed row rather than an aggregate. The audit trail is a
 * second, append-only table — see the entity docblocks for why the two are separate.
 */

export type ConsentChannel = MarketingConsent['channel']
export type ConsentState = MarketingConsent['state']
export type ConsentSource = MarketingConsent['source']

/**
 * What an absent record means.
 *
 * Permitted. The platform has no global consent model for this module to inherit, so treating silence as
 * refusal would silently disable every campaign on every existing installation the moment this shipped —
 * a change of behaviour nobody asked for, delivered as a bug report. An installation that needs opt-in
 * imports its consent, and the import source exists for exactly that.
 */
export const UNRECORDED_CONSENT_ALLOWS_SENDING = true

export async function loadConsentState(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  channel: ConsentChannel,
): Promise<ConsentState | null> {
  const record = await em.findOne(MarketingConsent, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    subjectEntityId,
    channel,
  })
  return record?.state ?? null
}

/** True when a message on this channel must NOT go out. */
export async function isSuppressedByConsent(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  channel: ConsentChannel,
): Promise<boolean> {
  const state = await loadConsentState(em, subjectEntityId, scope, channel)
  if (state === null) return !UNRECORDED_CONSENT_ALLOWS_SENDING
  return state === 'unsubscribed'
}

export type ConsentChange = {
  scope: SubjectScope
  subjectEntityId: string
  channel: ConsentChannel
  state: ConsentState
  reason?: string | null
  source: ConsentSource
  campaignId?: string | null
  now: Date
}

/**
 * Records a consent decision: the current state, and the history entry.
 *
 * Idempotent by state: re-recording the same answer updates the row's timestamp and still appends an
 * event, because "they clicked unsubscribe again" is a fact about what happened and a trail that silently
 * drops repeats cannot answer when a customer actually acted.
 */
export async function recordConsent(em: EntityManager, change: ConsentChange): Promise<ConsentState> {
  const existing = await em.findOne(MarketingConsent, {
    tenantId: change.scope.tenantId,
    organizationId: change.scope.organizationId,
    subjectEntityId: change.subjectEntityId,
    channel: change.channel,
  })

  if (existing) {
    existing.state = change.state
    existing.reason = change.reason ?? null
    existing.source = change.source
  } else {
    em.persist(em.create(MarketingConsent, {
      tenantId: change.scope.tenantId,
      organizationId: change.scope.organizationId,
      subjectEntityId: change.subjectEntityId,
      channel: change.channel,
      state: change.state,
      reason: change.reason ?? null,
      source: change.source,
    }))
  }

  em.persist(em.create(MarketingConsentEvent, {
    tenantId: change.scope.tenantId,
    organizationId: change.scope.organizationId,
    subjectEntityId: change.subjectEntityId,
    channel: change.channel,
    state: change.state,
    reason: change.reason ?? null,
    source: change.source,
    campaignId: change.campaignId ?? null,
    occurredAt: change.now,
  }))

  try {
    await em.flush()
  } catch (error) {
    /**
     * Losing the insert race is the unique index doing its job — but the losing DECISION still has to land.
     *
     * Two near-simultaneous writes are routine rather than exotic: an RFC 8058 client posts one-click while the
     * person also presses the button on the confirmation page. Both read no row, both insert, one loses. Without
     * any handling the endpoint answered 500 "you may still be subscribed" to somebody who had just been
     * unsubscribed, which is the worst thing this module can say.
     *
     * The earlier fix swallowed the violation on the grounds that "the other writer recorded the same
     * decision". That holds when both carry the same state and not otherwise: a one-click `unsubscribed` racing
     * somebody pressing "start receiving them again" are two different answers, and the loser vanished —
     * state and audit event both — leaving whichever won rather than whichever the person meant last.
     *
     * So the loser retries as an UPDATE, which cannot collide, and re-appends its event so the trail keeps both
     * decisions in the order they arrived. A second failure is a real one and propagates.
     */
    if (!(error instanceof UniqueConstraintViolationException)) throw error
    em.clear()

    const winner = await em.findOne(MarketingConsent, {
      tenantId: change.scope.tenantId,
      organizationId: change.scope.organizationId,
      subjectEntityId: change.subjectEntityId,
      channel: change.channel,
    })
    // Gone between the violation and this read: nothing to update, and re-inserting would race again.
    if (!winner) throw error

    winner.state = change.state
    winner.reason = change.reason ?? null
    winner.source = change.source
    em.persist(em.create(MarketingConsentEvent, {
      tenantId: change.scope.tenantId,
      organizationId: change.scope.organizationId,
      subjectEntityId: change.subjectEntityId,
      channel: change.channel,
      state: change.state,
      reason: change.reason ?? null,
      source: change.source,
      campaignId: change.campaignId ?? null,
      occurredAt: change.now,
    }))
    await em.flush()
  }
  return change.state
}
