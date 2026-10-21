import type {
  ChannelAdapter,
  ChannelNativeContent,
  ConvertOutboundInput,
  GetMessageStatusInput,
  InboundMessage,
  MessageStatus,
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
  ValidateCredentialsInput,
  ValidateCredentialsResult,
  VerifyWebhookInput,
  VerifyWebhookSubscriptionInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { whatsappCapabilities } from './capabilities'
import {
  parseWhatsappCredentialsOrThrow,
  resolveGraphUrl,
  WHATSAPP_CHANNEL_TYPE,
  WHATSAPP_PROVIDER_KEY,
  type WhatsappCredentials,
} from './credentials'
import { convertOutboundForWhatsApp } from './convert-outbound'
import { normalizeInboundWhatsAppMessage } from './normalize-inbound'
import { readHeader, verifyMetaSignature } from './webhook-signature'

type WhatsAppSendResponse = {
  messages?: Array<{ id?: string }>
  error?: { message?: string; code?: number }
}

type WhatsAppTemplate = {
  name: string
  languageCode: string
  components?: unknown[]
}

function readTemplate(metadata: Record<string, unknown> | undefined): WhatsAppTemplate | null {
  const raw = metadata?.template
  if (!raw || typeof raw !== 'object') return null
  const template = raw as Record<string, unknown>
  const name = typeof template.name === 'string' ? template.name.trim() : ''
  const languageCode = typeof template.languageCode === 'string' ? template.languageCode.trim() : ''
  if (!name || !languageCode) return null
  return {
    name,
    languageCode,
    components: Array.isArray(template.components) ? template.components : undefined,
  }
}

function resolveRecipient(input: SendMessageInput, credentials: WhatsappCredentials): string | null {
  const fromMetadata = input.metadata?.to
  if (typeof fromMetadata === 'string' && fromMetadata.trim().length) return fromMetadata.trim()
  return credentials.defaultRecipient ?? null
}

function buildPayload(
  input: SendMessageInput,
  recipient: string,
  native: ChannelNativeContent,
): Record<string, unknown> {
  const template = readTemplate(input.metadata)
  if (template) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        ...(template.components ? { components: template.components } : {}),
      },
    }
  }
  const metadata = native.metadata ?? {}
  const mediaType = metadata.whatsappMessageType
  const mediaLink = metadata.whatsappMediaLink
  if (typeof mediaLink === 'string' && mediaLink.length && typeof mediaType === 'string') {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: mediaType,
      [mediaType]: {
        link: mediaLink,
        ...(typeof metadata.whatsappMediaCaption === 'string'
          ? { caption: metadata.whatsappMediaCaption }
          : {}),
        ...(typeof metadata.whatsappMediaFilename === 'string'
          ? { filename: metadata.whatsappMediaFilename }
          : {}),
      },
    }
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: { preview_url: false, body: native.content.text ?? '' },
  }
}

class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly providerKey = WHATSAPP_PROVIDER_KEY
  readonly channelType = WHATSAPP_CHANNEL_TYPE
  readonly channelScope = 'tenant' as const
  readonly capabilities = whatsappCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = parseWhatsappCredentialsOrThrow(input.credentials)
    const recipient = resolveRecipient(input, credentials)
    if (!recipient) {
      return {
        externalMessageId: '',
        status: 'failed',
        error: 'No WhatsApp recipient — pass a phone number as the recipient, or set "Default recipient" on the connection.',
      }
    }
    const native = await this.convertOutbound({
      body: input.content.text ?? input.content.html ?? '',
      bodyFormat: input.content.bodyFormat ?? (input.content.html ? 'html' : 'text'),
      attachments: input.content.attachments,
      channelMetadata: input.metadata,
    })
    const payload = buildPayload(input, recipient, native)
    try {
      const response = await fetch(resolveGraphUrl(credentials, `${credentials.phoneNumberId}/messages`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      if (response.status === 401) {
        return { externalMessageId: '', status: 'failed', error: 'requires_reauth' }
      }
      const body = (await response.json().catch(() => ({}))) as WhatsAppSendResponse
      if (!response.ok) {
        return {
          externalMessageId: '',
          status: 'failed',
          error: body.error?.message ?? `WhatsApp send failed with status ${response.status}`,
        }
      }
      const externalMessageId = body.messages?.[0]?.id ?? ''
      if (!externalMessageId) {
        return {
          externalMessageId: '',
          status: 'failed',
          error: 'WhatsApp accepted the request without returning a message id',
        }
      }
      return {
        externalMessageId,
        conversationId: `whatsapp:${recipient}`,
        status: 'sent',
        metadata: {
          whatsappRecipient: recipient,
          whatsappPhoneNumberId: credentials.phoneNumberId,
          whatsappMessageType: payload.type,
        },
      }
    } catch (error) {
      return {
        externalMessageId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'WhatsApp send failed',
      }
    }
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage> {
    const credentials = parseWhatsappCredentialsOrThrow(input.credentials)
    if (!credentials.appSecret) {
      throw new Error('[internal] WhatsApp webhook cannot be verified without an app secret')
    }
    const signature = readHeader(input.headers, 'x-hub-signature-256')
    if (!verifyMetaSignature(input.rawBody, signature, credentials.appSecret)) {
      throw new Error('[internal] WhatsApp webhook signature verification failed')
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(input.rawBody.toString()) as Record<string, unknown>
    } catch {
      throw new Error('[internal] WhatsApp webhook body is not valid JSON')
    }
    const entry = Array.isArray(parsed.entry) ? parsed.entry[0] : null
    const change = entry && typeof entry === 'object'
      ? (entry as Record<string, unknown>).changes
      : null
    const value = Array.isArray(change) && change[0] && typeof change[0] === 'object'
      ? (change[0] as Record<string, unknown>).value as Record<string, unknown> | undefined
      : undefined
    const messages = Array.isArray(value?.messages) ? value.messages : []
    const statuses = Array.isArray(value?.statuses) ? value.statuses : []
    const eventType = messages.length ? 'message' : statuses.length ? 'status_update' : 'other'
    return { raw: parsed, eventType }
  }

  async verifyWebhookSubscription(input: VerifyWebhookSubscriptionInput): Promise<{ challenge: string }> {
    const credentials = parseWhatsappCredentialsOrThrow(input.credentials)
    const mode = input.query['hub.mode']
    const token = input.query['hub.verify_token']
    const challenge = input.query['hub.challenge']
    if (mode !== 'subscribe' || !credentials.verifyToken || token !== credentials.verifyToken || !challenge) {
      throw new Error('[internal] WhatsApp subscription verification failed')
    }
    return { challenge }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return convertOutboundForWhatsApp(input)
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    return normalizeInboundWhatsAppMessage(raw)
  }

  async validateCredentials(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    const credentials = parseWhatsappCredentialsOrThrow(input.credentials)
    try {
      const response = await fetch(resolveGraphUrl(credentials, credentials.phoneNumberId), {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      })
      if (response.status === 401) {
        return {
          ok: false,
          errors: { accessToken: 'WhatsApp rejected the access token (401).' },
          errorCodes: { accessToken: 'requires_reauth' },
        }
      }
      if (!response.ok) {
        return { ok: false, errors: { phoneNumberId: `WhatsApp validation failed with status ${response.status}` } }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, errors: { accessToken: error instanceof Error ? error.message : 'WhatsApp validation failed' } }
    }
  }
}

let adapter: WhatsAppChannelAdapter | null = null

export function getWhatsAppChannelAdapter(): WhatsAppChannelAdapter {
  if (!adapter) adapter = new WhatsAppChannelAdapter()
  return adapter
}
