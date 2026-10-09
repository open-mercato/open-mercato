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
import { mailjetCapabilities } from '../capabilities'
import { mailjetCredentialsSchema, type MailjetCredentials } from './credentials'

const MAILJET_SEND_URL = 'https://api.mailjet.com/v3.1/send'

type MailjetAttachment = {
  Filename: string
  ContentType: string
  Base64Content: string
}

function createAuthorization(credentials: MailjetCredentials): string {
  return `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.secretKey}`, 'utf8').toString('base64')}`
}

function attachmentsFromMeta(value: unknown): MailjetAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((item): MailjetAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const filename = stringOrUndefined(record.filename)
    const content = stringOrUndefined(record.content)
    if (!filename || !content) return []
    return [{
      Filename: filename,
      ContentType: stringOrUndefined(record.contentType) ?? 'application/octet-stream',
      Base64Content: content,
    }]
  })
  return attachments.length ? attachments : undefined
}

function safeErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const message = record.ErrorMessage ?? record.ErrorIdentifier
  return typeof message === 'string'
    ? sanitizeHeaderValue(message).slice(0, 300)
    : null
}

function mailjetMessageResult(payload: unknown): { messageId?: string; error?: string } {
  if (!payload || typeof payload !== 'object') return { error: 'Malformed provider response' }
  const messages = (payload as Record<string, unknown>).Messages
  if (!Array.isArray(messages) || !messages[0] || typeof messages[0] !== 'object') {
    return { error: 'Malformed provider response' }
  }
  const first = messages[0] as Record<string, unknown>
  if (first.Status !== 'success') {
    const errors = Array.isArray(first.Errors) ? first.Errors : []
    return { error: safeErrorMessage(errors[0]) ?? 'Message rejected by provider' }
  }
  const recipients = Array.isArray(first.To) ? first.To : []
  const recipient = recipients[0]
  if (!recipient || typeof recipient !== 'object') return {}
  const id = (recipient as Record<string, unknown>).MessageID
  return typeof id === 'string' || typeof id === 'number' ? { messageId: String(id) } : {}
}

async function resolveMailjetFailure(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    return safeErrorMessage(payload) ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

class MailjetChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'mailjet'
  readonly channelType = 'email'
  readonly capabilities = mailjetCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = mailjetCredentialsSchema.parse(input.credentials)
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
      Messages: [{
        From: { Email: sanitizeHeaderValue(stringOrUndefined(meta.from) ?? credentials.fromAddress) },
        To: to.map((Email) => ({ Email })),
        Subject: sanitizeHeaderValue(subject),
        ...(input.content.html ? { HTMLPart: input.content.html } : {}),
        ...(input.content.text ? { TextPart: input.content.text } : {}),
        ...(replyTo ? { ReplyTo: { Email: sanitizeHeaderValue(replyTo) } } : {}),
        ...(attachments ? { Attachments: attachments } : {}),
      }],
    }

    try {
      const response = await fetchWithTimeout(MAILJET_SEND_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: createAuthorization(credentials),
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      })
      if (!response.ok) {
        return {
          externalMessageId: '',
          status: 'failed',
          error: `MAILJET_SEND_FAILED: ${await resolveMailjetFailure(response)}`,
        }
      }
      const result = mailjetMessageResult(await response.json())
      if (result.error) {
        return { externalMessageId: '', status: 'failed', error: `MAILJET_SEND_FAILED: ${result.error}` }
      }
      return {
        externalMessageId: result.messageId ?? `mailjet:${Date.now()}`,
        conversationId: input.conversationId,
        status: 'sent',
      }
    } catch (error) {
      const message = error instanceof Error ? sanitizeHeaderValue(error.message).slice(0, 300) : 'Request failed'
      return { externalMessageId: '', status: 'failed', error: `MAILJET_SEND_FAILED: ${message}` }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'mailjet-system-email-outbound-only' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error('[internal] Mailjet system email adapter is outbound-only')
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

const adapter = new MailjetChannelAdapter()

export function getMailjetChannelAdapter(): ChannelAdapter {
  return adapter
}
