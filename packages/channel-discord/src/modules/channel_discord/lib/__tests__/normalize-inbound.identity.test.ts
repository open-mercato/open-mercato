import { normalizeInboundDiscordMessage } from '../normalize-inbound'
import type { DiscordMessageObject } from '../discord-rest'

/**
 * The sender-identity half of the inbound contract, pinned against a real
 * `MESSAGE_CREATE` frame captured from a live guild during QA of #4391.
 *
 * TC-CHANNEL-DISCORD-003 claimed to cover "an inbound Discord message lands in
 * the hub", but drove the generic email-shaped test-seed fixture with an invented
 * `@test-seed.local` address, so this function never executed on that path and
 * the test passed while real inbound was rejected (#4975). These assertions are
 * the ones that were actually missing: they run the mapper on the real payload
 * shape and pin the fact that a Discord sender carries a snowflake and nothing
 * email-like, which is precisely why the hub's `externalEmail` requirement makes
 * the two contracts incompatible.
 */
const GATEWAY_MESSAGE: DiscordMessageObject = {
  id: '1534333813851816108',
  channel_id: '1534331920463433771',
  guild_id: '1534331919796273152',
  content: 'Kolejna wiadomość testowa!@',
  timestamp: '2026-08-04T21:14:07.000000+00:00',
  author: {
    id: '1499156851487539260',
    username: 'lorakaspak',
    global_name: 'Karol Kapsa',
    bot: false,
  },
} as unknown as DiscordMessageObject

describe('normalizeInboundDiscordMessage — sender identity', () => {
  it('identifies the sender by Discord snowflake, not by an address', () => {
    const normalized = normalizeInboundDiscordMessage(GATEWAY_MESSAGE)

    expect(normalized.senderIdentifier).toBe('1499156851487539260')
    expect(normalized.senderDisplayName).toBe('Karol Kapsa')
    expect(normalized.externalMessageId).toBe('1534333813851816108')
    expect(normalized.externalConversationId).toBe('discord-channel:1534331920463433771')
  })

  it('produces no email-shaped sender value anywhere in the normalized message', () => {
    const normalized = normalizeInboundDiscordMessage(GATEWAY_MESSAGE)

    // The guard that matters: nothing the mapper emits can satisfy a
    // `z.string().email()` requirement, so any hub path demanding one rejects
    // every Discord message deterministically. Kept as an explicit assertion so
    // a future "just synthesise <id>@discord.invalid" workaround — explicitly
    // rejected in #4975 because it pollutes CRM contact resolution — fails here.
    expect(normalized.senderIdentifier).not.toMatch(/@/)
    expect(normalized.senderDisplayName ?? '').not.toMatch(/@/)
  })

  it('carries the Discord identity through channelMetadata for contact resolution', () => {
    const normalized = normalizeInboundDiscordMessage(GATEWAY_MESSAGE)

    expect(normalized.channelMetadata).toMatchObject({
      discordChannelId: '1534331920463433771',
      discordGuildId: '1534331919796273152',
      discordAuthorId: '1499156851487539260',
      discordAuthorUsername: 'lorakaspak',
      discordAuthorIsBot: false,
    })
  })
})
