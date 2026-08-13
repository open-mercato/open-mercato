import type { MessageFolder } from './useMessagesInboxBulkActions'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

type MessageParticipantSource = {
  senderName?: string | null
  senderEmail?: string | null
  /**
   * External participant identity, set when the message originates outside the
   * platform (inbound email/chat ingested by `communication_channels`). Such
   * messages are authored by the module's system user, so `senderName` /
   * `senderEmail` are empty and the external identity is the only human-readable
   * label available.
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
 * specificity: platform user identity, then external (ingested) identity, then
 * the raw user id as a last resort.
 *
 * Shared by the inbox list and the message detail header so both render an
 * inbound email as "Jane Doe" / "jane@example.com" rather than the
 * `communication_channels` system user id.
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
