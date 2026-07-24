import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
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
import { normalizeEnvString } from '@open-mercato/shared/lib/email/config'
import { sesCapabilities } from '../capabilities'
import { sesCredentialsSchema } from './credentials'

type SesAttachment = {
  filename: string
  content: string
  encoding: 'base64'
  contentType?: string
}

type SesSendInfo = {
  messageId?: string
  response?: string
}

type SesTransportOptions = {
  SES: {
    sesClient: SESv2Client
    SendEmailCommand: typeof SendEmailCommand
  }
}

type SesMailOptions = Parameters<ReturnType<typeof nodemailer.createTransport>['sendMail']>[0] & {
  ses?: {
    ConfigurationSetName?: string
  }
}

function resolveRegion(credentialsRegion: string | undefined): string | undefined {
  return credentialsRegion || normalizeEnvString(process.env.AWS_SES_REGION) || normalizeEnvString(process.env.AWS_REGION)
}

function attachmentsFromMeta(value: unknown): SesAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((item): SesAttachment[] => {
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

class SesChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'ses'
  readonly channelType = 'email'
  readonly capabilities = sesCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = sesCredentialsSchema.parse(input.credentials)
    const meta = (input.metadata ?? {}) as Record<string, unknown>
    const to = Array.isArray(meta.to) ? (meta.to as string[]) : []
    if (to.length === 0) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires at least one recipient' }
    }
    const subject = stringOrUndefined(meta.subject)
    if (!subject) {
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires a subject' }
    }

    const region = resolveRegion(credentials.region)
    const sesClient = new SESv2Client(region ? { region } : {})
    const transporter = nodemailer.createTransport({
      SES: { sesClient, SendEmailCommand },
    } as Parameters<typeof nodemailer.createTransport>[0] & SesTransportOptions)
    const configurationSetName = stringOrUndefined(credentials.configurationSetName)
    const options: SesMailOptions = {
      from: stringOrUndefined(meta.from) ?? credentials.fromAddress,
      to,
      subject,
      ...(input.content.text ? { text: input.content.text } : {}),
      ...(input.content.html ? { html: input.content.html } : {}),
      ...(stringOrUndefined(meta.replyTo) ? { replyTo: stringOrUndefined(meta.replyTo) } : {}),
      ...(attachmentsFromMeta(meta.attachments)?.length ? { attachments: attachmentsFromMeta(meta.attachments) } : {}),
      ...(configurationSetName ? { ses: { ConfigurationSetName: configurationSetName } } : {}),
    }

    try {
      const info = await transporter.sendMail(options) as SesSendInfo
      return {
        externalMessageId: info.messageId || `ses:${Date.now()}`,
        conversationId: input.conversationId,
        status: 'sent',
        metadata: info.response ? { response: info.response } : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { externalMessageId: '', status: 'failed', error: `SES_SEND_FAILED: ${message}` }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'ses-system-email-outbound-only' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error('[internal] Amazon SES system email adapter is outbound-only')
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

const adapter = new SesChannelAdapter()

export function getSesChannelAdapter(): ChannelAdapter {
  return adapter
}
