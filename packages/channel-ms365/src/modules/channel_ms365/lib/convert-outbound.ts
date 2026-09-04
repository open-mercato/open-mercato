import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  assembleRfc2822,
  escapeQuotes,
  generateMessageId,
  htmlToText,
  referencesFromMeta,
  stringOrUndefined,
  toAddressList,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'

/**
 * Convert a hub-canonical outbound payload to a Microsoft 365-ready native
 * content shape. Like Gmail, the adapter builds the RFC2822 message itself:
 * Graph accepts the raw MIME as the body of `POST /me/messages` (draft) and
 * the draft is then sent with `POST /me/messages/{id}/send`.
 *
 * Output metadata fields:
 *   - rawMessage: Buffer — the assembled RFC2822 message
 *   - subject / to / cc / bcc / inReplyTo / references / messageId — diagnostic copies
 */

export interface Ms365EmailNativeMetadata {
  subject?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  inReplyTo?: string
  references?: string[]
  messageId: string
  fromAddress: string
  fromName?: string
  rawMessage: Buffer
}

export interface ConvertOutboundForMs365Input extends ConvertOutboundInput {
  fromAddress: string
  fromName?: string
}

export async function convertOutboundForMs365(
  input: ConvertOutboundForMs365Input,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('[internal] Microsoft 365 outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = referencesFromMeta(meta.references)
  const messageId = stringOrUndefined(meta.messageId) ?? generateMessageId(input.fromAddress, 'outlook.com')

  const html = input.bodyFormat === 'html' ? input.body : undefined
  const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body

  const rawMessage = assembleRfc2822({
    from: input.fromName ? `"${escapeQuotes(input.fromName)}" <${input.fromAddress}>` : input.fromAddress,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    inReplyTo,
    references,
    messageId,
  })

  const metadata: Ms365EmailNativeMetadata = {
    subject,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    inReplyTo,
    references,
    messageId,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
    rawMessage,
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
      },
    },
    metadata: metadata as unknown as Record<string, unknown>,
  }
}
