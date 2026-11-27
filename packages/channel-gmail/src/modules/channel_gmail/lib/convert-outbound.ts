import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  composeEmailMessage,
  escapeQuotes,
  generateMessageId,
  headersFromMeta,
  htmlToText,
  referencesFromMeta,
  stringOrUndefined,
  toAddressList,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'
import { resolveOutboundAttachmentBytes } from '@open-mercato/core/modules/communication_channels/lib/outbound-attachments'
import { GMAIL_THREAD_REF_PREFIX } from './normalize-inbound'

export interface GmailEmailNativeMetadata {
  subject?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  inReplyTo?: string
  references?: string[]
  messageId?: string
  threadId?: string
  fromAddress: string
  fromName?: string
  rawMessage: Buffer
}

export interface ConvertOutboundForGmailInput extends ConvertOutboundInput {
  fromAddress: string
  fromName?: string
}

/**
 * Resolve the Gmail native `threadId` so replies attach to the original Gmail
 * conversation. Order of precedence:
 *   1. `gmailThreadId` — explicit, set by inbound normalization metadata.
 *   2. `threadId` — passed from outbound preparation to `sendMessage`.
 *   3. `thread_id` — the hub's generic conversation ref; for an existing Gmail
 *      thread it is `gmail-thread:<rawId>` (see `normalize-inbound`). A new
 *      outbound thread uses an `outbound:<uuid>` ref with no Gmail thread yet,
 *      so `threadId` stays unset and Gmail opens a fresh server-side thread.
 */
function deriveGmailThreadId(meta: Record<string, unknown>): string | undefined {
  const explicit = stringOrUndefined(meta.gmailThreadId) ?? stringOrUndefined(meta.threadId)
  if (explicit) return explicit
  const conversationRef = stringOrUndefined(meta.thread_id)
  if (conversationRef && conversationRef.startsWith(GMAIL_THREAD_REF_PREFIX)) {
    const rawThreadId = conversationRef.slice(GMAIL_THREAD_REF_PREFIX.length)
    return rawThreadId.length > 0 ? rawThreadId : undefined
  }
  return undefined
}

export function prepareOutboundForGmail(input: ConvertOutboundInput, fromAddress = '') {
  const meta = input.channelMetadata ?? {}
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('[internal] Gmail outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = referencesFromMeta(meta.references)
  const messageId = stringOrUndefined(meta.messageId) ?? generateMessageId(fromAddress, 'gmail.com')
  const threadId = deriveGmailThreadId(meta)

  const html = input.bodyFormat === 'html' ? input.body : undefined
  const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body

  const raw = { subject, to, cc, bcc, inReplyTo, references, messageId, threadId }
  return {
    content: { text, html, bodyFormat: input.bodyFormat, attachments: input.attachments, raw },
    metadata: {
      ...raw,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
    },
  }
}

export async function convertOutboundForGmail(
  input: ConvertOutboundForGmailInput,
): Promise<ChannelNativeContent> {
  const { content, metadata } = prepareOutboundForGmail(input, input.fromAddress)
  const { subject, to, cc, bcc, inReplyTo, references, messageId } = content.raw
  const { text, html } = content
  const rawMessage = await composeEmailMessage({
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
    extraHeaders: headersFromMeta(meta.headers),
    attachments: (input.attachments ?? []).map((attachment) => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      content: resolveOutboundAttachmentBytes(attachment),
      inline: attachment.inline,
    })),
  })

  return {
    content,
    metadata: {
      ...metadata,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      rawMessage,
    } satisfies GmailEmailNativeMetadata,
  }
}
