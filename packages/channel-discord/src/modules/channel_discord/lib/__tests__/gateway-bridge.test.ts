import { buildInboundMessageJob, buildReactionJob, type GatewayChannelScope } from '../gateway-bridge'
import type { DiscordMessageObject } from '../discord-rest'

const channel: GatewayChannelScope = {
  channelId: 'channel-uuid',
  channelType: 'discord',
  tenantId: 'tenant-uuid',
  organizationId: 'org-uuid',
}

function makeMessage(authorId: string): DiscordMessageObject {
  return {
    id: 'm1',
    channel_id: 'disc-chan',
    content: 'hi',
    author: { id: authorId, username: 'u' },
    timestamp: '2026-06-19T10:00:00.000Z',
  }
}

describe('buildInboundMessageJob', () => {
  it('produces a hub inbound job for a non-bot message', () => {
    const job = buildInboundMessageJob({ message: makeMessage('user-1'), channel, botUserId: 'bot-1' })
    expect(job).not.toBeNull()
    expect(job?.providerKey).toBe('discord')
    expect(job?.channelId).toBe('channel-uuid')
    expect(job?.raw.eventType).toBe('message')
    expect(job?.scope).toEqual({ tenantId: 'tenant-uuid', organizationId: 'org-uuid' })
    expect((job?.raw.raw as { discordMessage?: unknown }).discordMessage).toBeTruthy()
  })

  it('returns null for the bot own message (feedback-loop guard)', () => {
    const job = buildInboundMessageJob({ message: makeMessage('bot-1'), channel, botUserId: 'bot-1' })
    expect(job).toBeNull()
  })
})

describe('buildReactionJob', () => {
  it('builds a normalized reaction job with mapped emoji', async () => {
    const job = await buildReactionJob({
      reaction: { message_id: 'm1', channel_id: 'disc-chan', user_id: 'user-2', emoji: { name: '👍', id: null } },
      action: 'added',
      channel,
      botUserId: 'bot-1',
    })
    expect(job).not.toBeNull()
    expect(job?.kind).toBe('inbound')
    expect(job?.event.emoji).toBe('👍')
    expect(job?.event.action).toBe('added')
    expect(job?.event.externalMessageId).toBe('m1')
  })

  it('returns null for a reaction the bot itself added', async () => {
    const job = await buildReactionJob({
      reaction: { message_id: 'm1', channel_id: 'disc-chan', user_id: 'bot-1', emoji: { name: '👍' } },
      action: 'added',
      channel,
      botUserId: 'bot-1',
    })
    expect(job).toBeNull()
  })
})
