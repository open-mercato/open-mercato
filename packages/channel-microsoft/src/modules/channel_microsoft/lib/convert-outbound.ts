import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import type { GraphSendMailInput } from './graph-client'

/**
 * Convert a hub-canonical outbound payload to a Microsoft Graph `sendMail` body.
 *
 * Unlike Gmail (which expects base64url RFC2822) Microsoft Graph accepts a
 * structured JSON Message resource. We assemble the right shape here so
 * `sendMessage` is a single POST.
 *
 * Output metadata fields:
 *   - sendMailBody: GraphSendMailInput  — ready for POST /me/sendMail
 *   - subject / to / cc / bcc / messageId / conversationId — diagnostics
 */
export interface MicrosoftEmailNativeMetadata {
  subject?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  inReplyTo?: string
  references?: string[]
  messageId?: string
  conversationId?: string
  fromAddress: string
  fromName?: string
  sendMailBody: GraphSendMailInput
}

export interface ConvertOutboundForMicrosoftInput extends ConvertOutboundInput {
  fromAddress: string
  fromName?: string
}

export async function convertOutboundForMicrosoft(
  input: ConvertOutboundForMicrosoftInput,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('Microsoft outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = Array.isArray(meta.references)
    ? meta.references.filter((v): v is string => typeof v === 'string')
    : undefined
  const messageId = stringOrUndefined(meta.messageId) ?? generateMessageId(input.fromAddress)
  const conversationId = stringOrUndefined(meta.microsoftConversationId)

  const html = input.bodyFormat === 'html' ? input.body : undefined
  const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body

  const internetMessageHeaders: Array<{ name: string; value: string }> = []
  // Microsoft Graph requires every `internetMessageHeader.name` to start with
  // `x-` or `X-` — standard RFC headers (In-Reply-To / References / Message-ID)
  // are managed by the platform and can't be set here. To keep diagnostic
  // breadcrumbs we use `x-omc-*` mirrors. Real RFC 5322 threading happens via
  // the `replyTo` / `replyAll` Graph endpoints, NOT /me/sendMail — replies
  // initiated against an existing Message id automatically carry the right
  // In-Reply-To/References chain on the server side.
  // Reference: https://learn.microsoft.com/en-us/graph/api/resources/internetmessageheader
  internetMessageHeaders.push({ name: 'x-omc-message-id', value: messageId })
  if (inReplyTo) internetMessageHeaders.push({ name: 'x-omc-in-reply-to', value: ensureBrackets(inReplyTo) })
  if (references?.length) internetMessageHeaders.push({ name: 'x-omc-references', value: references.map(ensureBrackets).join(' ') })

  // conversationId is READ-ONLY on the Graph Message resource — it's computed
  // server-side from the In-Reply-To / Thread-Index header chain. Setting it
  // on POST is silently ignored today but may be rejected by future API
  // versions, so we drop it from the request body.
  const sendMailBody: GraphSendMailInput = {
    message: {
      subject,
      body: {
        contentType: input.bodyFormat === 'html' ? 'HTML' : 'Text',
        content: input.body,
      },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: cc.length ? cc.map((address) => ({ emailAddress: { address } })) : undefined,
      bccRecipients: bcc.length ? bcc.map((address) => ({ emailAddress: { address } })) : undefined,
      internetMessageHeaders,
    },
    saveToSentItems: true,
  }

  const metadata: MicrosoftEmailNativeMetadata = {
    subject,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    inReplyTo,
    references,
    messageId,
    conversationId,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
    sendMailBody,
  }

  return {
    content: {
      text,
      html,
      bodyFormat: input.bodyFormat,
      attachments: input.attachments,
      raw: {
        subject,
        to,
        cc,
        bcc,
        inReplyTo,
        references,
        messageId,
        conversationId,
      },
    },
    metadata: metadata as unknown as Record<string, unknown>,
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toAddressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v.length > 0)
  if (typeof value === 'string') {
    return value
      .split(/[,;]\s*/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }
  return []
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ensureBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return `<${trimmed}>`
}

function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] ?? 'outlook.com'
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `<${random}@${domain}>`
}
