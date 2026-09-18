import type { InboundMessage } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import type { InboundProcessorPayload } from '@open-mercato/core/modules/communication_channels/workers/inbound-processor'
import type { ReactionInboundJob } from '@open-mercato/core/modules/communication_channels/lib/reaction-processor-types'
import type { DiscordMessageObject } from './discord-rest'
import { getDiscordChannelAdapter } from './adapter'
import { isAuthoredByBot } from './normalize-inbound'
import { DISCORD_CONVERSATION_PREFIX } from './normalize-inbound'

export interface GatewayChannelScope {
  channelId: string
  channelType: string
  tenantId: string
  organizationId: string | null
}

/**
 * Build the hub inbound-processor job for a `MESSAGE_CREATE` gateway event.
 *
 * Returns `null` when the message was authored by the bot itself — this is the
 * feedback-loop guard the spec requires (the bot must never ingest + answer its
 * own outbound messages). The hub then dedups by `(channel_id, external_message_id)`.
 *
 * The raw Discord object is wrapped as an `InboundMessage` so the existing
 * `inbound-processor` worker calls `adapter.normalizeInbound` exactly as it does
 * for the webhook path — no hub change.
 */
export function buildInboundMessageJob(input: {
  message: DiscordMessageObject
  channel: GatewayChannelScope
  botUserId: string | undefined
}): InboundProcessorPayload | null {
  const { message, channel, botUserId } = input
  if (isAuthoredByBot(message, botUserId)) return null

  const raw: InboundMessage = {
    raw: { discordMessage: message as unknown as Record<string, unknown> },
    eventType: 'message',
  }
  return {
    providerKey: 'discord',
    channelId: channel.channelId,
    channelType: channel.channelType,
    raw,
    scope: { tenantId: channel.tenantId, organizationId: channel.organizationId },
  }
}

/**
 * Build the hub reaction-processor job for a `MESSAGE_REACTION_ADD/REMOVE`
 * gateway event. Returns `null` for reactions the bot itself added. The reaction
 * is normalized through the adapter so it matches the webhook reaction path.
 */
export async function buildReactionJob(input: {
  reaction: Record<string, unknown>
  action: 'added' | 'removed'
  channel: GatewayChannelScope
  botUserId: string | undefined
}): Promise<ReactionInboundJob | null> {
  const { reaction, action, channel, botUserId } = input
  const reactionUserId = typeof reaction.user_id === 'string' ? reaction.user_id : undefined
  if (botUserId && reactionUserId === botUserId) return null

  const event = await getDiscordChannelAdapter().normalizeInboundReaction({
    raw: { discordReaction: { ...reaction, action } },
    eventType: 'reaction',
  })

  return {
    kind: 'inbound',
    providerKey: 'discord',
    channelId: channel.channelId,
    channelType: channel.channelType,
    event,
    scope: { tenantId: channel.tenantId, organizationId: channel.organizationId },
    attempt: 1,
  }
}

export { DISCORD_CONVERSATION_PREFIX }
