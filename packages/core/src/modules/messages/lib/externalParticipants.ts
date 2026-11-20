import type { EntityManager } from '@mikro-orm/postgresql'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { getEmailDeliveryMaxHours, getEmailDeliveryRetryDelaySeconds } from '@open-mercato/shared/lib/email/delivery-config'
import { Message, MessageExternalParticipant } from '../data/entities'
import { emitMessagesEvent } from '../events'
import type { ExternalParticipantDeliveryStatus, ExternalParticipantRole } from '../data/entities'
import type { ExternalParticipantInput } from '../data/validators'

export type PlannedExternalParticipant = {
  email: string
  emailHash: string
  name: string | null
  role: ExternalParticipantRole
  deliveryStatus: ExternalParticipantDeliveryStatus | null
}

export type ComposeExternalParticipantsPlan = {
  externalEmail: string | undefined
  participants: PlannedExternalParticipant[]
}

type ComposeExternalAddressing = {
  externalEmail?: string
  externalEmails?: string[]
  externalParticipants?: ExternalParticipantInput[]
  inboundFromChannel?: boolean
  isDraft?: boolean
}

/**
 * Outbound: every addressee becomes a `pending` participant and the first "to"
 * address stays in `messages.external_email`. Inbound: `external_email` keeps the
 * sender and only the extra To/CC passed by ingest are stored, without status.
 * Drafts store their addressees without status; sending the draft marks them `pending`.
 */
export function planComposeExternalParticipants(input: ComposeExternalAddressing): ComposeExternalParticipantsPlan {
  const inbound = input.inboundFromChannel === true
  const toAddresses = inbound ? [] : (input.externalEmails ?? (input.externalEmail ? [input.externalEmail] : []))
  const externalEmail = input.externalEmail ?? toAddresses[0]
  const withoutStatus = inbound || input.isDraft === true

  const candidates: ExternalParticipantInput[] = [
    ...toAddresses.map((email) => ({ email, role: 'to' as const })),
    ...(input.externalParticipants ?? []),
  ]
  const seen = new Set<string>()
  const participants: PlannedExternalParticipant[] = []
  for (const candidate of candidates) {
    const email = candidate.email.trim()
    const emailHash = hashForLookup(email)
    const key = `${candidate.role}:${emailHash}`
    if (seen.has(key)) continue
    seen.add(key)
    participants.push({
      email,
      emailHash,
      name: candidate.name ?? null,
      role: candidate.role,
      deliveryStatus: withoutStatus ? null : 'pending',
    })
  }
  return { externalEmail, participants }
}

export type ExternalDeliveryOutcome = { sentAt: Date } | { error: string }

/**
 * Keeps the `messages.external_email_*` summary in step with participant delivery:
 * the first acceptance wins and a later failure never overwrites it.
 */
export async function recordExternalDeliverySummary(
  em: EntityManager,
  target: { messageId: string; tenantId: string; organizationId: string | null },
  outcome: ExternalDeliveryOutcome,
): Promise<void> {
  await em.nativeUpdate(
    Message,
    {
      id: target.messageId,
      tenantId: target.tenantId,
      organizationId: target.organizationId,
      externalEmailSentAt: null,
    },
    'sentAt' in outcome
      ? { externalEmailSentAt: outcome.sentAt, externalEmailFailedAt: null, externalEmailError: null }
      : { externalEmailFailedAt: new Date(), externalEmailError: outcome.error },
  )
}

/** Internal marker stored in `delivery_error`; the UI maps it to a translated label. */
export const DELIVERY_WINDOW_EXCEEDED_ERROR = 'delivery window exceeded'
/** Written on participants of a scheduled message whose sender mailbox cannot deliver at release. */
export const MAILBOX_UNAVAILABLE_ERROR = 'mailbox unavailable'

export type TransientRetryPlan = { nextAttemptAt: Date } | { expired: true }

/**
 * When a transiently failed participant is tried next: the provider's retry time,
 * else `delayMs`, else `OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS`, never past the
 * `OM_EMAIL_DELIVERY_MAX_HOURS` window counted from the message's send time.
 */
export function planTransientRetry(input: {
  messageSentAt?: Date | null
  retryAt?: Date | null
  delayMs?: number
  now?: Date
}): TransientRetryPlan {
  const now = input.now ?? new Date()
  const windowEnd = new Date((input.messageSentAt ?? now).getTime() + getEmailDeliveryMaxHours() * 3_600_000)
  if (now.getTime() >= windowEnd.getTime()) return { expired: true }
  const planned = input.retryAt ?? new Date(now.getTime() + (input.delayMs ?? getEmailDeliveryRetryDelaySeconds() * 1000))
  return { nextAttemptAt: planned.getTime() < windowEnd.getTime() ? planned : windowEnd }
}

export type ExternalParticipantSettlement = {
  sent?: string[]
  failed?: Array<{ id: string; error: string }>
  retry?: Array<{ id: string; error: string; nextAttemptAt: Date }>
}

export type ExternalDeliveryTarget = { messageId: string; tenantId: string; organizationId: string | null }

/**
 * Writes participant outcomes and emits `messages.message.delivery_finished` when
 * this write moved the last `pending` participant of the message out of `pending`.
 * The per-message advisory lock serializes concurrent links, so it fires once.
 * `claimedUntil` restricts the writes to rows the caller claimed, `pendingOnly` to rows still pending.
 */
export async function settleExternalParticipants(
  em: EntityManager,
  target: ExternalDeliveryTarget,
  settlement: ExternalParticipantSettlement,
  options: { claimedUntil?: Date | null; pendingOnly?: boolean } = {},
): Promise<{ finished: boolean }> {
  const scope = { messageId: target.messageId, tenantId: target.tenantId, organizationId: target.organizationId }
  const owned = options.claimedUntil
    ? { ...scope, deliveryStatus: 'pending' as const, nextAttemptAt: options.claimedUntil }
    : options.pendingOnly ? { ...scope, deliveryStatus: 'pending' as const } : scope
  const sentIds = settlement.sent ?? []
  const failed = settlement.failed ?? []
  const retry = settlement.retry ?? []
  if (sentIds.length === 0 && failed.length === 0 && retry.length === 0) return { finished: false }

  const counts = await withAdvisoryXactLock(em, `messages:external_delivery:${target.messageId}`, async (tx) => {
    const now = new Date()
    let settled = 0
    if (sentIds.length > 0) {
      settled += await tx.nativeUpdate(
        MessageExternalParticipant,
        { ...owned, id: { $in: sentIds } },
        { deliveryStatus: 'sent', sentAt: now, deliveryError: null, nextAttemptAt: null },
      )
    }
    for (const entry of failed) {
      settled += await tx.nativeUpdate(
        MessageExternalParticipant,
        { ...owned, id: entry.id },
        { deliveryStatus: 'failed', deliveryError: entry.error, nextAttemptAt: null },
      )
    }
    for (const entry of retry) {
      await tx.nativeUpdate(
        MessageExternalParticipant,
        { ...owned, id: entry.id },
        { deliveryStatus: 'pending', deliveryError: entry.error, nextAttemptAt: entry.nextAttemptAt },
      )
    }
    if (settled === 0) return null
    if ((await tx.count(MessageExternalParticipant, { ...scope, deliveryStatus: 'pending' })) > 0) return null
    return {
      sentCount: await tx.count(MessageExternalParticipant, { ...scope, deliveryStatus: 'sent' }),
      failedCount: await tx.count(MessageExternalParticipant, { ...scope, deliveryStatus: 'failed' }),
    }
  })
  if (!counts) return { finished: false }
  await emitMessagesEvent(
    'messages.message.delivery_finished',
    { messageId: target.messageId, ...counts, tenantId: target.tenantId, organizationId: target.organizationId },
    { persistent: true },
  )
  return { finished: true }
}
