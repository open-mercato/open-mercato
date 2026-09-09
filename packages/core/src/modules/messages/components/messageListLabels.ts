import type { MessageFolder } from './useMessagesInboxBulkActions'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

/**
 * `Message.sourceEntityType` written by `communication_channels`'
 * `ingest-inbound-message` command, and by nothing else — the outbound bridge
 * treats it as the marker that a message arrived from outside the platform
 * rather than being sent from it. It is the only reliable inbound
 * discriminator: `type` is `channel.<provider>` on the outbound
 * `send-as-user` path too, where `externalName` carries the recipient side.
 */
const INBOUND_EXTERNAL_SOURCE_ENTITY_TYPE = 'communication_channels.external_conversation'

type MessageParticipantSource = {
  senderName?: string | null
  senderEmail?: string | null
  /**
   * The external counterparty on a message that crosses the platform boundary —
   * the sender for an inbound email/chat ingested by `communication_channels`,
   * the recipient for an outbound reply sent through `inbox_ops`. Which side it
   * represents is decided by `sourceEntityType`, not by whether a platform
   * sender happens to be present.
   */
  externalName?: string | null
  externalEmail?: string | null
  sourceEntityType?: string | null
  senderUserId: string
  recipientCount?: number | null
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function isInboundExternalMessage(item: MessageParticipantSource): boolean {
  return item.sourceEntityType === INBOUND_EXTERNAL_SOURCE_ENTITY_TYPE
}

/**
 * Human-readable label for a message's author.
 *
 * An ingested inbound message is authored by the external counterparty, even
 * though it is composed under a platform user id: that id is the
 * `communication_channels` system user, or — once an operator assigns the
 * conversation — the assigned agent, who resolves to a real name in the user
 * directory and would otherwise be printed as the author of the customer's own
 * email. So on the inbound side the external identity wins, and the platform
 * identity is only the fallback. Everywhere else the platform sender is the
 * author and the external identity describes the recipient, so the order is
 * reversed. The raw user id remains the last resort in both directions.
 *
 * The single source of truth for every place the messages module prints a
 * participant — the inbox list, the detail header and the conversation rows —
 * so an ingested email renders as "Jane Doe" / "jane@example.com" rather than
 * the `communication_channels` system user id or the agent handling it.
 */
export function getMessageParticipantLabel(item: MessageParticipantSource): string {
  const platformIdentity = normalizeLabel(item.senderName) ?? normalizeLabel(item.senderEmail)
  const externalIdentity = normalizeLabel(item.externalName) ?? normalizeLabel(item.externalEmail)
  const preferred = isInboundExternalMessage(item) ? externalIdentity : platformIdentity
  const fallback = isInboundExternalMessage(item) ? platformIdentity : externalIdentity

  return preferred ?? fallback ?? item.senderUserId
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
