import type { NormalizedInboundMessage } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  normalizeMimeInbound,
  type ParsedMail,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'

/**
 * Convert a raw RFC2822 MIME buffer (delivered by IMAP fetch) to the hub's
 * canonical `NormalizedInboundMessage`. Parses with `mailparser`, then delegates
 * threading / attachments / headers to the shared `normalizeMimeInbound` helper.
 *
 * Threading:
 *   - `externalMessageId`     := MIME `Message-ID` header (RFC2822). Required by
 *     IMAP/SMTP; if missing we fall back to `imap:<uid>@<account>` so downstream
 *     idempotency still has a deterministic key.
 *   - `replyToExternalId`     := `In-Reply-To` header (single value).
 *   - `externalConversationId` := the root of the References chain when present,
 *     otherwise the message id itself (single-message thread).
 */

export interface NormalizeInboundOptions {
  rawMessage: Buffer
  /** UID from the IMAP fetch — embedded into `channelMetadata.uid` for diagnostics. */
  uid?: number
  /** External identifier of the receiving channel (typically the account's email). */
  accountIdentifier: string
  /** Fallback timestamp if the parsed message has no Date header. */
  fallbackDate?: Date
}

export async function normalizeInboundImapMessage(
  options: NormalizeInboundOptions,
): Promise<NormalizedInboundMessage> {
  const mailparser = (await import('mailparser')) as unknown as {
    simpleParser: (buf: Buffer | string) => Promise<ParsedMail>
  }
  const parsed = await mailparser.simpleParser(options.rawMessage)

  return normalizeMimeInbound({
    parsed,
    accountIdentifier: options.accountIdentifier,
    fallbackMessageId: `imap:${options.uid ?? 'unknown'}@${options.accountIdentifier}`,
    resolveConversationId: ({ messageId, references }) => references[0] ?? messageId,
    fallbackDate: options.fallbackDate,
    channelMetadata: () => ({ uid: options.uid }),
  })
}
