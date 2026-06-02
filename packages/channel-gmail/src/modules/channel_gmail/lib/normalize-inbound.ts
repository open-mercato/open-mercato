import type { NormalizedInboundMessage } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  normalizeMimeInbound,
  type ParsedMail,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'

/**
 * Prefix for the hub conversation ref of a Gmail-threaded conversation; the raw
 * Gmail `threadId` follows it. Single-sourced here (where the ref is formed) and
 * re-used by the outbound converter to recover the thread id for replies.
 */
export const GMAIL_THREAD_REF_PREFIX = 'gmail-thread:'

/**
 * Convert a Gmail `messages.get?format=raw` response to the hub's canonical
 * `NormalizedInboundMessage`. Gmail returns the full RFC2822 message base64url-encoded,
 * so we parse with `mailparser` (same library the IMAP provider uses) and let the
 * shared `normalizeMimeInbound` helper handle threading / attachments / headers,
 * layering in Gmail-specific metadata (`threadId`, `labelIds`, Gmail message id).
 *
 * Threading uses Gmail's `threadId` (more reliable than In-Reply-To inside
 * Gmail's mailbox).
 */

export interface NormalizeInboundGmailOptions {
  rawMessage: Buffer
  gmailMessageId: string
  gmailThreadId: string
  gmailLabelIds?: string[]
  accountIdentifier: string
  fallbackDate?: Date
}

export async function normalizeInboundGmailMessage(
  options: NormalizeInboundGmailOptions,
): Promise<NormalizedInboundMessage> {
  const mailparser = (await import('mailparser')) as unknown as {
    simpleParser: (buf: Buffer | string) => Promise<ParsedMail>
  }
  const parsed = await mailparser.simpleParser(options.rawMessage)

  const gmailFields = {
    gmailMessageId: options.gmailMessageId,
    gmailThreadId: options.gmailThreadId,
    gmailLabelIds: options.gmailLabelIds ?? [],
  }
  return normalizeMimeInbound({
    parsed,
    accountIdentifier: options.accountIdentifier,
    fallbackMessageId: `gmail:${options.gmailMessageId}@${options.accountIdentifier}`,
    // Gmail's threadId is authoritative for conversation grouping.
    resolveConversationId: () => `${GMAIL_THREAD_REF_PREFIX}${options.gmailThreadId}`,
    fallbackDate: options.fallbackDate,
    channelMetadata: () => gmailFields,
    channelPayload: () => gmailFields,
  })
}
