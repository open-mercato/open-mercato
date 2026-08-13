import type { MessageFolder } from './useMessagesInboxBulkActions'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

type MessageParticipantSource = {
  senderName?: string | null
  senderEmail?: string | null
  /**
   * The external counterparty on a message that crosses the platform boundary —
   * the sender for an inbound email/chat ingested by `communication_channels`,
   * the recipient for an outbound reply sent through `inbox_ops`. It is used as
   * the author label only on the inbound side, where the message is composed by
   * the ingesting module's system user and `senderName` / `senderEmail` are
   * therefore empty; an outbound message always carries a real platform sender,
   * which wins in the chain below before the external identity is consulted.
   */
  externalName?: string | null
  externalEmail?: string | null
  senderUserId: string
  recipientCount?: number | null
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/**
 * Human-readable label for a message's author, in descending order of
 * specificity: platform user identity, then the external counterparty identity,
 * then the raw user id as a last resort.
 *
 * The single source of truth for every place the messages module prints a
 * participant — the inbox list, its sender filter, the detail header and the
 * conversation rows — so an ingested email renders as "Jane Doe" /
 * "jane@example.com" rather than the `communication_channels` system user id.
 */
export function getMessageParticipantLabel(item: MessageParticipantSource): string {
  return normalizeLabel(item.senderName)
    ?? normalizeLabel(item.senderEmail)
    ?? normalizeLabel(item.externalName)
    ?? normalizeLabel(item.externalEmail)
    ?? item.senderUserId
}

export function getMessageListParticipantLabel(
  item: MessageParticipantSource,
  folder: MessageFolder,
  t: Translate,
): string {
  if ((folder === 'sent' || folder === 'drafts') && Number(item.recipientCount ?? 0) <= 0) {
    return t('messages.list.noRecipient', '(No recipient)')
  }

  return getMessageParticipantLabel(item)
}
