import {
  normalizeInboundDiscordMessage,
  isAuthoredByBot,
  DISCORD_CONVERSATION_PREFIX,
} from '../normalize-inbound'
import type { DiscordMessageObject } from '../discord-rest'

function makeMessage(overrides: Partial<DiscordMessageObject> = {}): DiscordMessageObject {
  return {
    id: 'msg-1',
    channel_id: 'chan-9',
    guild_id: 'guild-3',
    content: 'hello world',
    author: { id: 'user-42', username: 'alice', global_name: 'Alice A.' },
    timestamp: '2026-06-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeInboundDiscordMessage', () => {
  it('maps a Discord message to the hub NormalizedInboundMessage shape', () => {
    const result = normalizeInboundDiscordMessage(makeMessage())
    expect(result.externalMessageId).toBe('msg-1')
    expect(result.externalConversationId).toBe(`${DISCORD_CONVERSATION_PREFIX}chan-9`)
    expect(result.senderIdentifier).toBe('user-42')
    expect(result.senderDisplayName).toBe('Alice A.')
    expect(result.body).toBe('hello world')
    expect(result.bodyFormat).toBe('markdown')
    expect(result.channelContentType).toBe('discord')
    expect(result.channelMetadata.discordChannelId).toBe('chan-9')
    expect(result.channelMetadata.discordGuildId).toBe('guild-3')
    expect(result.timestamp.toISOString()).toBe('2026-06-19T10:00:00.000Z')
  })

  it('carries reply-to from message_reference and maps attachments', () => {
    const result = normalizeInboundDiscordMessage(
      makeMessage({
        message_reference: { message_id: 'parent-7' },
        attachments: [{ id: 'a1', url: 'https://cdn/x.png', filename: 'x.png', content_type: 'image/png', size: 10 }],
      }),
    )
    expect(result.replyToExternalId).toBe('parent-7')
    expect(result.attachments?.[0]).toMatchObject({ url: 'https://cdn/x.png', mimeType: 'image/png', fileName: 'x.png' })
  })

  it('falls back to username when global_name is absent', () => {
    const result = normalizeInboundDiscordMessage(
      makeMessage({ author: { id: 'u', username: 'bob', global_name: null } }),
    )
    expect(result.senderDisplayName).toBe('bob')
  })
})

describe('isAuthoredByBot', () => {
  it('is true when the author id matches the bot user id', () => {
    expect(isAuthoredByBot(makeMessage({ author: { id: 'bot-1', username: 'bot' } }), 'bot-1')).toBe(true)
  })
  it('is false for a non-bot human author', () => {
    expect(isAuthoredByBot(makeMessage({ author: { id: 'user-42', username: 'alice' } }), 'bot-1')).toBe(false)
  })
  it('is true for ANY bot author, not just our own bot (cross-bot loop guard)', () => {
    expect(isAuthoredByBot(makeMessage({ author: { id: 'other-bot', username: 'webhook', bot: true } }), 'bot-1')).toBe(true)
  })
  it('falls back to the bot flag when no bot id is known', () => {
    expect(isAuthoredByBot(makeMessage({ author: { id: 'x', username: 'x', bot: true } }), undefined)).toBe(true)
  })
})
