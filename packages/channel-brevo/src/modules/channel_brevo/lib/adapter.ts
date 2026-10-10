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
  VerifyWebhookInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  htmlToText,
  sanitizeHeaderValue,
  stringOrUndefined,
  toAddressList,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { brevoCapabilities } from '../capabilities'
import { brevoCredentialsSchema } from './credentials'

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

type BrevoAttachment = {
  name: string
  content: string
}

function attachmentsFromMeta(value: unknown): BrevoAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((item): BrevoAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const name = stringOrUndefined(record.filename)
    const content = stringOrUndefined(record.content)
    return name && content ? [{ name, content }] : []
  })
  return attachments.length ? attachments : undefined
}

function safeErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string'
    ? sanitizeHeaderValue(message).slice(0, 300)
    : null
}

async function resolveBrevoFailure(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    return safeErrorMessage(payload) ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

class BrevoChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'brevo'
  readonly channelType = 'email'
  readonly capabilities = brevoCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = brevoCredentialsSchema.parse(input.credentials)
    const meta = (input.metadata ?? {}) as Record<string, unknown>
    const to = toAddressList(meta.to).map(sanitizeHeaderValue)
    if (to.length === 0) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires at least one recipient' }
    }
    const subject = stringOrUndefined(meta.subject)
    if (!subject) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires a subject' }
    }

    const replyTo = stringOrUndefined(meta.replyTo)
    const attachments = attachmentsFromMeta(meta.attachments)
    const payload = {
      sender: { email: sanitizeHeaderValue(stringOrUndefined(meta.from) ?? credentials.fromAddress) },
      to: to.map((email) => ({ email })),
      subject: sanitizeHeaderValue(subject),
      ...(input.content.html ? { htmlContent: input.content.html } : {}),
      ...(input.content.text ? { textContent: input.content.text } : {}),
      ...(replyTo ? { replyTo: { email: sanitizeHeaderValue(replyTo) } } : {}),
      ...(attachments ? { attachment: attachments } : {}),
    }

    try {
      const response = await fetchWithTimeout(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': credentials.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      })
      if (!response.ok) {
        return {
          externalMessageId: '',
          status: 'failed',
          error: `BREVO_SEND_FAILED: ${await resolveBrevoFailure(response)}`,
        }
      }
      const result: unknown = await response.json()
      const messageId = result && typeof result === 'object'
        ? stringOrUndefined((result as Record<string, unknown>).messageId)
        : undefined
      return {
        externalMessageId: messageId ?? `brevo:${Date.now()}`,
        conversationId: input.conversationId,
        status: 'sent',
      }
    } catch (error) {
      const message = error instanceof Error ? sanitizeHeaderValue(error.message).slice(0, 300) : 'Request failed'
      return { externalMessageId: '', status: 'failed', error: `BREVO_SEND_FAILED: ${message}` }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'brevo-system-email-outbound-only' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error('[internal] Brevo system email adapter is outbound-only')
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
    const html = input.bodyFormat === 'html' ? input.body : undefined
    return {
      content: {
        text: input.bodyFormat === 'html' ? htmlToText(input.body) : input.body,
        html,
        bodyFormat: input.bodyFormat,
      },
      metadata: {
        to: toAddressList(meta.to).map(sanitizeHeaderValue),
        subject: stringOrUndefined(meta.subject),
        from: stringOrUndefined(meta.from),
        replyTo: stringOrUndefined(meta.replyTo),
        attachments: Array.isArray(meta.attachments) ? meta.attachments : undefined,
      },
    }
  }
}

const adapter = new BrevoChannelAdapter()

export function getBrevoChannelAdapter(): ChannelAdapter {
  return adapter
}
