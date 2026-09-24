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
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  htmlToText,
  sanitizeHeaderValue,
  stringOrUndefined,
  toAddressList,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'
import { smtpCapabilities } from '../capabilities'
import { smtpCredentialsSchema } from './credentials'
import { credentialsToConnection, getSmtpTransport, type SmtpAttachment } from './transport'
import { validateSmtpCredentials } from './validate-credentials'

function attachmentsFromMeta(value: unknown): SmtpAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((item): SmtpAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const filename = stringOrUndefined(record.filename)
    const content = stringOrUndefined(record.content)
    if (!filename || !content) return []
    const contentType = stringOrUndefined(record.contentType)
    return [{
      filename,
      content,
      encoding: 'base64',
      ...(contentType ? { contentType } : {}),
    }]
  })
  return attachments.length ? attachments : undefined
}

class SmtpChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'smtp'
  readonly channelType = 'email'
  readonly channelScope = 'tenant' as const
  readonly capabilities = smtpCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = smtpCredentialsSchema.parse(input.credentials)
    const meta = (input.metadata ?? {}) as Record<string, unknown>
    // `convertOutbound` hands us an array, but the hub's test-send route calls
    // `sendMessage` directly with the operator's raw `to` string. Normalizing
    // here keeps both callers working; `toAddressList` also splits the
    // comma/semicolon-separated form system email supports.
    const to = toAddressList(meta.to).map(sanitizeHeaderValue)
    if (to.length === 0) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires at least one recipient' }
    }
    const subject = stringOrUndefined(meta.subject)
    if (!subject) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires a subject' }
    }

    const attachments = attachmentsFromMeta(meta.attachments)
    try {
      const info = await getSmtpTransport().send(credentialsToConnection(credentials), {
        from: stringOrUndefined(meta.from) ?? credentials.fromAddress,
        to,
        subject,
        ...(input.content.text ? { text: input.content.text } : {}),
        ...(input.content.html ? { html: input.content.html } : {}),
        ...(stringOrUndefined(meta.replyTo) ? { replyTo: stringOrUndefined(meta.replyTo) } : {}),
        ...(attachments?.length ? { attachments } : {}),
      })
      const externalMessageId = info.messageId || `smtp:${Date.now()}`
      const accepted = info.accepted ?? []
      const rejected = info.rejected ?? []
      const metadata = {
        ...(info.response ? { response: info.response } : {}),
        ...(info.accepted ? { accepted } : {}),
        ...(rejected.length ? { rejected } : {}),
      }
      // The relay resolves the send once it accepts *any* recipient, so a
      // partial rejection would otherwise be reported as an unqualified
      // success and silently drop mail. Report it as a failure carrying the
      // message identity and the accepted/rejected split, so a retry can skip
      // the recipients that already landed instead of resending to everyone.
      if (rejected.length > 0) {
        return {
          externalMessageId,
          conversationId: input.conversationId,
          status: 'failed',
          error: `SMTP_SEND_PARTIALLY_REJECTED: relay rejected ${rejected.join(', ')}`,
          metadata,
        }
      }
      return {
        externalMessageId,
        conversationId: input.conversationId,
        status: 'sent',
        metadata: Object.keys(metadata).length ? metadata : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { externalMessageId: '', status: 'failed', error: `SMTP_SEND_FAILED: ${message}` }
    }
  }

  async validateCredentials(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    return validateSmtpCredentials(input.credentials)
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'smtp-system-email-outbound-only' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error('[internal] SMTP system email adapter is outbound-only')
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
      },
    }
  }
}

const adapter = new SmtpChannelAdapter()

export function getSmtpChannelAdapter(): ChannelAdapter {
  return adapter
}
