import type { EntityManager } from '@mikro-orm/postgresql'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { Message } from '../data/entities'
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
