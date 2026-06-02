import type { MessageFolder } from './useMessagesInboxBulkActions'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

type MessageParticipantSource = {
  senderName?: string | null
  senderEmail?: string | null
  senderUserId: string
  recipientCount?: number | null
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function getMessageListParticipantLabel(
  item: MessageParticipantSource,
  folder: MessageFolder,
  t: Translate,
): string {
  if ((folder === 'sent' || folder === 'drafts') && Number(item.recipientCount ?? 0) <= 0) {
    return t('messages.list.noRecipient', '(No recipient)')
  }

  return normalizeLabel(item.senderName)
    ?? normalizeLabel(item.senderEmail)
    ?? item.senderUserId
}
