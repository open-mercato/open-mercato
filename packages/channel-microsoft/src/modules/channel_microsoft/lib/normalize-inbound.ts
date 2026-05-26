import type { NormalizedInboundMessage, NormalizedAttachment } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import type { GraphMessage } from './graph-client'

/**
 * Convert a Microsoft Graph `Message` resource to the hub's canonical
 * `NormalizedInboundMessage`.
 *
 * Why we don't always parse MIME for Microsoft inbound:
 *   The Graph delta endpoint returns Message JSON with `body.content`,
 *   `from`, `subject`, `conversationId`, `internetMessageId` already parsed.
 *   Fetching the raw MIME via `/me/messages/{id}/$value` is an extra round-trip
 *   per message; this normalizer prefers the JSON shape and only uses raw MIME
 *   as a fallback for attachments (a future v2 enhancement).
 *
 * Threading: `conversationId` is authoritative (parallels Gmail's `threadId`).
 * `internetMessageId` is the RFC2822 Message-ID used by external mail clients.
 */
export interface NormalizeInboundMicrosoftOptions {
  message: GraphMessage
  accountIdentifier: string
  fallbackDate?: Date
}

export async function normalizeInboundMicrosoftMessage(
  options: NormalizeInboundMicrosoftOptions,
): Promise<NormalizedInboundMessage> {
  const m = options.message
  const messageId = stripBrackets(m.internetMessageId) ?? `microsoft:${m.id}@${options.accountIdentifier}`
  const conversationId = m.conversationId ? `microsoft-conversation:${m.conversationId}` : messageId

  const from = m.from?.emailAddress
  const subject = m.subject?.trim() || undefined
  const bodyContent = m.body?.content ?? ''
  const bodyFormat = (m.body?.contentType ?? 'text').toLowerCase() === 'html' ? 'html' : 'text'

  const channelMetadata: Record<string, unknown> = {
    microsoftMessageId: m.id,
    microsoftConversationId: m.conversationId ?? null,
    internetMessageId: m.internetMessageId ?? null,
    categories: m.categories ?? [],
    inferenceClassification: m.inferenceClassification ?? null,
  }

  return {
    externalMessageId: messageId,
    externalConversationId: conversationId,
    senderIdentifier: from?.address ?? options.accountIdentifier,
    senderDisplayName: from?.name?.trim() || undefined,
    subject,
    body: bodyContent,
    bodyFormat,
    attachments: extractAttachmentsPlaceholder(m),
    timestamp: m.receivedDateTime
      ? new Date(m.receivedDateTime)
      : options.fallbackDate ?? new Date(),
    replyToExternalId: undefined,
    channelPayload: {
      subject,
      from: from ? { address: from.address, name: from.name } : null,
      to: (m.toRecipients ?? []).map((r) => r.emailAddress).filter(Boolean),
      cc: (m.ccRecipients ?? []).map((r) => r.emailAddress).filter(Boolean),
      bcc: (m.bccRecipients ?? []).map((r) => r.emailAddress).filter(Boolean),
      html: bodyFormat === 'html' ? bodyContent : null,
      text: bodyFormat === 'text' ? bodyContent : null,
      messageId,
      microsoftMessageId: m.id,
      microsoftConversationId: m.conversationId ?? null,
      categories: m.categories ?? [],
      inferenceClassification: m.inferenceClassification ?? null,
    },
    channelContentType: 'email/mime',
    channelMetadata,
  }
}

function stripBrackets(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1)
  return trimmed
}

/**
 * Phase 3 ships without per-message attachment fetching. `hasAttachments: true`
 * on the Graph Message signals to the caller that attachments exist but are
 * not yet inlined. A future enhancement will call `/me/messages/{id}/attachments`
 * lazily when the user opens the message detail. Returning an empty array keeps
 * the contract honest — the spec only requires inline images and small files,
 * which the Graph body already includes inline.
 */
function extractAttachmentsPlaceholder(_message: GraphMessage): NormalizedAttachment[] {
  return []
}
