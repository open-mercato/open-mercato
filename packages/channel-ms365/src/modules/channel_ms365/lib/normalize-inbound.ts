import type { NormalizedInboundMessage } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  normalizeMimeInbound,
  type ParsedMail,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'

/**
 * Convert a raw RFC2822 MIME buffer (from `GET /me/messages/{id}/$value`) to
 * the hub's canonical `NormalizedInboundMessage`. Parses with `mailparser`
 * (same library the Gmail/IMAP providers use) and delegates threading /
 * attachments / headers to the shared `normalizeMimeInbound` helper.
 *
 * Threading follows the IMAP provider (RFC2822 headers, not the provider's
 * own thread id) so conversations look the same regardless of which email
 * provider delivered them:
 *   - `externalMessageId`      := MIME `Message-ID`; fallback `ms365:<graphId>@<account>`.
 *   - `replyToExternalId`      := `In-Reply-To`.
 *   - `externalConversationId` := root of the `References` chain, else the message id.
 * Graph's `conversationId` is kept in `channelMetadata` for diagnostics only.
 */

export interface NormalizeInboundMs365Options {
  rawMessage: Buffer
  graphMessageId: string
  graphConversationId?: string
  internetMessageId?: string
  /** External identifier of the receiving channel (the mailbox address). */
  accountIdentifier: string
  /** Fallback timestamp if the parsed message has no Date header. */
  fallbackDate?: Date
}

export async function normalizeInboundMs365Message(
  options: NormalizeInboundMs365Options,
): Promise<NormalizedInboundMessage> {
  const mailparser = (await import('mailparser')) as unknown as {
    simpleParser: (buf: Buffer | string) => Promise<ParsedMail>
  }
  const parsed = await mailparser.simpleParser(options.rawMessage)

  const graphFields = {
    graphMessageId: options.graphMessageId,
    graphConversationId: options.graphConversationId,
    internetMessageId: options.internetMessageId,
  }
  return normalizeMimeInbound({
    parsed,
    accountIdentifier: options.accountIdentifier,
    fallbackMessageId: `ms365:${options.graphMessageId}@${options.accountIdentifier}`,
    resolveConversationId: ({ messageId, references }) => references[0] ?? messageId,
    fallbackDate: options.fallbackDate,
    channelMetadata: () => graphFields,
    channelPayload: () => graphFields,
  })
}
