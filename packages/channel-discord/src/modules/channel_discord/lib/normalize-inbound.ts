import type {
  NormalizedInboundMessage,
  NormalizedAttachment,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import type { DiscordMessageObject } from './discord-rest'

/**
 * Prefix used to build the hub's `externalConversationId` from a Discord channel
 * (or thread) id. A Discord "channel" (text channel / thread) is the unit the
 * hub threads on, mirroring `gmail-thread:` / Slack channel conventions.
 */
export const DISCORD_CONVERSATION_PREFIX = 'discord-channel:'

export const DISCORD_CHANNEL_CONTENT_TYPE = 'discord'

function mapAttachments(message: DiscordMessageObject): NormalizedAttachment[] | undefined {
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) return undefined
  return message.attachments.map((attachment) => ({
    url: attachment.url,
    mimeType: attachment.content_type ?? 'application/octet-stream',
    fileName: attachment.filename,
    fileSize: attachment.size,
    inline: false,
  }))
}

/**
 * Map a raw Discord message object (from `MESSAGE_CREATE` or REST history) into
 * the hub's canonical `NormalizedInboundMessage`.
 *
 * Discord senders have no email/phone — the CRM contact is resolved from the
 * user id / handle later (`resolveContact`). The `externalConversationId` is the
 * channel/thread id (a Discord thread reuses this same shape), so all messages
 * in one channel thread into one hub conversation.
 */
export function normalizeInboundDiscordMessage(message: DiscordMessageObject): NormalizedInboundMessage {
  const author = message.author ?? ({} as DiscordMessageObject['author'])
  const senderDisplayName = author?.global_name || author?.username || undefined
  const timestamp = message.timestamp ? new Date(message.timestamp) : new Date()

  return {
    externalMessageId: message.id,
    externalConversationId: `${DISCORD_CONVERSATION_PREFIX}${message.channel_id}`,
    senderIdentifier: author?.id ?? 'unknown',
    senderDisplayName,
    body: message.content ?? '',
    bodyFormat: 'markdown',
    attachments: mapAttachments(message),
    timestamp,
    replyToExternalId: message.message_reference?.message_id,
    channelPayload: message as unknown as Record<string, unknown>,
    channelContentType: DISCORD_CHANNEL_CONTENT_TYPE,
    channelMetadata: {
      discordChannelId: message.channel_id,
      discordGuildId: message.guild_id,
      discordAuthorId: author?.id,
      discordAuthorUsername: author?.username,
      discordAuthorGlobalName: author?.global_name ?? undefined,
      discordAuthorIsBot: Boolean(author?.bot),
    },
  }
}

/**
 * True when a raw message must be dropped as bot-authored. The gateway worker
 * uses this as the feedback-loop guard.
 *
 * We drop ANY message flagged `author.bot` (not just our own bot's user id):
 * other bots/webhooks in the channel would otherwise be ingested and could
 * trigger the AI auto-reply, creating cross-bot loops and noise. The explicit
 * `botUserId` check is retained as a belt-and-suspenders guard for the rare case
 * where our own bot's `author.bot` flag is absent from a payload.
 */
export function isAuthoredByBot(message: DiscordMessageObject, botUserId: string | undefined): boolean {
  if (message.author?.bot) return true
  return botUserId ? message.author?.id === botUserId : false
}
