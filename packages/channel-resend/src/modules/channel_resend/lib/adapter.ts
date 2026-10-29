import { Resend } from 'resend'
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
import { resendCapabilities } from '../capabilities'
import { resendCredentialsSchema } from './credentials'

type ResendAttachment = {
  filename: string
  content: string
  contentType?: string
}

type ResendSendResult = {
  data?: { id?: string | null } | null
  error?: unknown
}

function resolveResendErrorMessage(result: unknown): string | null {
  const value = result as ResendSendResult
  if (typeof value.error === 'string') return value.error
  if (value.error && typeof value.error === 'object' && 'message' in value.error) {
    const message = (value.error as { message?: unknown }).message
    return typeof message === 'string' ? message : null
  }
  return null
}

function attachmentsFromMeta(value: unknown): ResendAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((item): ResendAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const filename = stringOrUndefined(record.filename)
    const content = stringOrUndefined(record.content)
    if (!filename || !content) return []
    const contentType = stringOrUndefined(record.contentType)
    return [{ filename, content, ...(contentType ? { contentType } : {}) }]
  })
  return attachments.length ? attachments : undefined
}

/**
 * MIME headers the caller asked for, sanitised.
 *
 * Resend takes a `headers` object, so this is the one email adapter that can carry
 * `List-Unsubscribe` / `List-Unsubscribe-Post` — the pair Gmail's and Yahoo's bulk-sender rules require.
 * Values go through `sanitizeHeaderValue` for the same reason `to` and `from` do: a newline in a header
 * value is a header-injection, and these values are composed from configuration and campaign data.
 */
function headersFromMeta(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const headers: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    // A header NAME with anything but token characters in it is not a header; drop it rather than send it.
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue
    const sanitized = sanitizeHeaderValue(raw).trim()
    if (sanitized) headers[name] = sanitized
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

class ResendChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'resend'
  readonly channelType = 'email'
  readonly capabilities = resendCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = resendCredentialsSchema.parse(input.credentials)
    const meta = (input.metadata ?? {}) as Record<string, unknown>
    const to = toAddressList(meta.to).map(sanitizeHeaderValue)
    if (to.length === 0) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires at least one recipient' }
    }
    const subject = stringOrUndefined(meta.subject)
    if (!subject) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires a subject' }
    }

    const client = new Resend(credentials.apiKey)
    const resendAttachments = attachmentsFromMeta(meta.attachments)
    const resendHeaders = headersFromMeta(meta.headers)
    const basePayload = {
      from: stringOrUndefined(meta.from) ?? credentials.fromAddress,
      to,
      subject,
      ...(stringOrUndefined(meta.replyTo) ? { replyTo: stringOrUndefined(meta.replyTo) } : {}),
      ...(resendAttachments?.length ? { attachments: resendAttachments } : {}),
      ...(resendHeaders ? { headers: resendHeaders } : {}),
    }
    const payload: Parameters<typeof client.emails.send>[0] = input.content.html
      ? { ...basePayload, html: input.content.html, ...(input.content.text ? { text: input.content.text } : {}) }
      : { ...basePayload, text: input.content.text ?? '' }
    const result = await client.emails.send(payload)
    const errorMessage = resolveResendErrorMessage(result)
    if (errorMessage) {
      return { externalMessageId: '', status: 'failed', error: `RESEND_SEND_FAILED: ${errorMessage}` }
    }
    const sentId = (result as ResendSendResult).data?.id
    return {
      externalMessageId: sentId || `resend:${Date.now()}`,
      conversationId: input.conversationId,
      status: 'sent',
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'resend-system-email-outbound-only' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error('[internal] Resend system email adapter is outbound-only')
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
    const to = toAddressList(meta.to).map(sanitizeHeaderValue)
    const subject = stringOrUndefined(meta.subject)
    const html = input.bodyFormat === 'html' ? input.body : undefined
    const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body
    return {
      content: {
        text,
        html,
        bodyFormat: input.bodyFormat,
      },
      metadata: {
        to,
        subject,
        from: stringOrUndefined(meta.from),
        replyTo: stringOrUndefined(meta.replyTo),
        attachments: attachmentsFromMeta(meta.attachments),
        headers: headersFromMeta(meta.headers),
      },
    }
  }
}

const adapter = new ResendChannelAdapter()

export function getResendChannelAdapter(): ChannelAdapter {
  return adapter
}
