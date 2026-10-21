import type {
  InboundMessage,
  NormalizedAttachment,
  NormalizedInboundMessage,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'

export const WHATSAPP_CONVERSATION_PREFIX = 'whatsapp:'

type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

type ParsedWebhook = {
  value: RawRecord | null
  message: RawRecord | null
  status: RawRecord | null
  metadata: RawRecord | null
  contacts: unknown[]
}

function parseWebhookPayload(raw: RawRecord): ParsedWebhook {
  const entry = asRecord(asArray(raw.entry)[0])
  const change = asRecord(asArray(entry?.changes)[0])
  const value = asRecord(change?.value)
  return {
    value,
    message: asRecord(asArray(value?.messages)[0]),
    status: asRecord(asArray(value?.statuses)[0]),
    metadata: asRecord(value?.metadata),
    contacts: asArray(value?.contacts),
  }
}

function extractBody(message: RawRecord): string {
  const type = asString(message.type)
  if (type === 'text') return asString(asRecord(message.text)?.body) ?? ''
  if (type === 'button') return asString(asRecord(message.button)?.text) ?? ''
  if (type === 'interactive') {
    const interactive = asRecord(message.interactive)
    const buttonReply = asRecord(interactive?.button_reply)
    const listReply = asRecord(interactive?.list_reply)
    return asString(buttonReply?.title) ?? asString(listReply?.title) ?? ''
  }
  const media = type ? asRecord(message[type]) : null
  return asString(media?.caption) ?? ''
}

function extractAttachments(message: RawRecord): NormalizedAttachment[] {
  const type = asString(message.type)
  if (!type || type === 'text' || type === 'button' || type === 'interactive') return []
  const media = asRecord(message[type])
  if (!media) return []
  const id = asString(media.id)
  const mimeType = asString(media.mime_type) ?? 'application/octet-stream'
  const fileName = asString(media.filename) ?? `${type}-${id ?? 'media'}`
  return [{
    url: id ? `whatsapp-media://${id}` : '',
    mimeType,
    fileName,
    fileSize: typeof media.file_size === 'number' ? media.file_size : undefined,
  }]
}

export function normalizeInboundWhatsAppMessage(raw: InboundMessage): NormalizedInboundMessage {
  const payload = asRecord(raw.raw) ?? {}
  const parsed = parseWebhookPayload(payload)

  if (!parsed.message) {
    if (parsed.status) {
      const recipient = asString(parsed.status.recipient_id) ?? 'unknown'
      return {
        externalMessageId: asString(parsed.status.id) ?? `${recipient}-${Date.now()}`,
        externalConversationId: `${WHATSAPP_CONVERSATION_PREFIX}${recipient}`,
        senderIdentifier: recipient,
        body: '',
        bodyFormat: 'text',
        timestamp: new Date(Number(parsed.status.timestamp ?? 0) * 1000),
        channelPayload: payload,
        channelContentType: 'status',
        channelMetadata: {
          status: asString(parsed.status.status) ?? null,
          whatsappPhoneNumberId: asString(parsed.metadata?.phone_number_id),
        },
      }
    }
    throw new Error('[internal] WhatsApp webhook payload contains no message or status')
  }

  const message = parsed.message
  const sender = asString(message.from) ?? 'unknown'
  const externalMessageId = asString(message.id) ?? `${sender}-${Date.now()}`
  const timestampSeconds = Number(message.timestamp ?? 0)
  const contact = asRecord(parsed.contacts[0])
  const profile = asRecord(contact?.profile)

  return {
    externalMessageId,
    externalConversationId: `${WHATSAPP_CONVERSATION_PREFIX}${sender}`,
    senderIdentifier: sender,
    senderDisplayName: asString(profile?.name) ?? undefined,
    body: extractBody(message),
    bodyFormat: 'text',
    attachments: extractAttachments(message),
    timestamp: Number.isFinite(timestampSeconds) && timestampSeconds > 0
      ? new Date(timestampSeconds * 1000)
      : new Date(),
    replyToExternalId: asString(asRecord(message.context)?.id) ?? undefined,
    channelPayload: payload,
    channelContentType: asString(message.type) ?? 'text',
    channelMetadata: {
      whatsappMessageId: externalMessageId,
      whatsappPhoneNumberId: asString(parsed.metadata?.phone_number_id),
      whatsappType: asString(message.type) ?? 'text',
    },
  }
}
