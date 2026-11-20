import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import { MessageExternalParticipant, MessageRecipient } from '../data/entities'

export const RECIPIENT_SUMMARY_LABEL_LIMIT = 3

export type RecipientSummary = { labels: string[]; total: number }

type Scope = { tenantId: string; organizationId: string | null }

const ROLE_ORDER: Record<string, number> = { to: 0, cc: 1, bcc: 2 }

function roleRank(role: string | null | undefined): number {
  return ROLE_ORDER[role ?? ''] ?? 3
}

/**
 * Who a message went to, for the author's list folders (sent, drafts, scheduled):
 * internal recipients first, then external addresses, each in to → cc → bcc order.
 * Only the first few labels are returned; `total` counts everyone.
 */
export async function buildRecipientSummaries(
  em: EntityManager,
  messages: Array<{ id: string; externalEmail?: string | null }>,
  scope: Scope,
): Promise<Map<string, RecipientSummary>> {
  const summaries = new Map<string, RecipientSummary>()
  if (messages.length === 0) return summaries
  const messageIds = messages.map((message) => message.id)

  const [recipients, participants] = await Promise.all([
    em.find(MessageRecipient, { messageId: { $in: messageIds }, deletedAt: null }),
    findWithDecryption(em, MessageExternalParticipant, { messageId: { $in: messageIds } }, undefined, scope),
  ])

  const userIds = Array.from(new Set(recipients.map((recipient) => recipient.recipientUserId)))
  const users = userIds.length > 0
    ? await findWithDecryption(em, User, { id: { $in: userIds } }, undefined, scope)
    : []
  const userLabelById = new Map<string, string>()
  for (const user of users) {
    const name = typeof user.name === 'string' ? user.name.trim() : ''
    userLabelById.set(user.id, name || user.email || user.id)
  }

  const entriesByMessage = new Map<string, Array<{ group: number; rank: number; label: string }>>()
  const push = (messageId: string, entry: { group: number; rank: number; label: string }) => {
    const entries = entriesByMessage.get(messageId) ?? []
    entries.push(entry)
    entriesByMessage.set(messageId, entries)
  }
  for (const recipient of recipients) {
    push(recipient.messageId, {
      group: 0,
      rank: roleRank(recipient.recipientType),
      label: userLabelById.get(recipient.recipientUserId) ?? recipient.recipientUserId,
    })
  }
  for (const participant of participants) {
    if (!participant.email) continue
    push(participant.messageId, { group: 1, rank: roleRank(participant.role), label: participant.email })
  }

  for (const message of messages) {
    const entries = entriesByMessage.get(message.id) ?? []
    if (entries.length === 0 && message.externalEmail) {
      entries.push({ group: 1, rank: 0, label: message.externalEmail })
    }
    if (entries.length === 0) continue
    entries.sort((left, right) => left.group - right.group || left.rank - right.rank)
    summaries.set(message.id, {
      labels: entries.slice(0, RECIPIENT_SUMMARY_LABEL_LIMIT).map((entry) => entry.label),
      total: entries.length,
    })
  }
  return summaries
}
