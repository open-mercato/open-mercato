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
import { GMAIL_THREAD_REF_PREFIX } from './normalize-inbound'

/**
 * Convert a hub-canonical outbound payload to a Gmail-ready native content shape.
 *
 * Unlike IMAP/SMTP (which hands the message to nodemailer), the Gmail adapter
 * builds the RFC2822 message itself and sends via `gmail.users.messages.send`.
 * The converter pre-builds the raw message so `sendMessage` is a pure
 * "base64url-encode + POST" call, with no SMTP transport involved.
 *
 * Output metadata fields:
 *   - rawMessage: Buffer  — the assembled RFC2822 message
 *   - threadId: string?   — Gmail thread id (resolved by deriveGmailThreadId)
 *   - subject / to / cc / bcc / inReplyTo / references — diagnostic copies
 */

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
 *   2. `threadId` — survives the hub's convert→send double-conversion, where
 *      `sendMessage` re-converts the already-converted metadata.
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

export async function convertOutboundForGmail(
  input: ConvertOutboundForGmailInput,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('[internal] Gmail outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = referencesFromMeta(meta.references)
  const messageId = stringOrUndefined(meta.messageId) ?? generateMessageId(input.fromAddress, 'gmail.com')
  const threadId = deriveGmailThreadId(meta)

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

  const metadata: GmailEmailNativeMetadata = {
    subject,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    inReplyTo,
    references,
    messageId,
    threadId,
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
        threadId,
      },
    },
    metadata: metadata as unknown as Record<string, unknown>,
  }
}
