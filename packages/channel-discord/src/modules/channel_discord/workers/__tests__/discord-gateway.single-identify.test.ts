import {
  botTokenFingerprint,
  findChannelWithSameBot,
  type GatewayConnectionEntry,
} from '../discord-gateway'
import type { DiscordGatewayHandle } from '../../lib/discord-gateway-client'

/**
 * Regression guard for the duplicate-session half of #4977.
 *
 * The hub derives a channel's `externalIdentifier` by sniffing the credential
 * bag for email-shaped keys (`username` / `email` / `fromAddress`), none of
 * which a Discord credential bag has. Every reconnect therefore inserts a second
 * active channel row for the same bot instead of healing the first, and QA
 * observed the gateway opening two parallel WebSocket sessions with two distinct
 * Discord session ids — defeating the single-identify-per-bot discipline that
 * `concurrency: 1` exists to enforce.
 *
 * The real fix is hub-side (let the adapter supply an identity); this guard is
 * the interim one that keeps the second socket from ever opening.
 */
function fakeEntry(
  tenantId: string,
  fingerprint: string | undefined,
  active = true,
): GatewayConnectionEntry {
  const handle: DiscordGatewayHandle = { close: jest.fn(), isActive: () => active }
  return { handle, tenantId, botTokenFingerprint: fingerprint }
}

describe('botTokenFingerprint', () => {
  it('is stable for the same token and different for another', () => {
    expect(botTokenFingerprint('bot-token-a')).toBe(botTokenFingerprint('bot-token-a'))
    expect(botTokenFingerprint('bot-token-a')).not.toBe(botTokenFingerprint('bot-token-b'))
  })

  it('never reveals the token it was derived from', () => {
    const token = 'MTIzNDU2Nzg5.super.secret-bot-token'
    const fingerprint = botTokenFingerprint(token)
    expect(fingerprint).not.toContain(token)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('findChannelWithSameBot', () => {
  it('reports the channel already serving the same bot', () => {
    const fingerprint = botTokenFingerprint('one-bot')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-first', fakeEntry('t1', fingerprint)],
    ])

    expect(findChannelWithSameBot('chan-duplicate', fingerprint, connections)).toBe('chan-first')
  })

  it('does not treat a channel as its own duplicate', () => {
    const fingerprint = botTokenFingerprint('one-bot')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-first', fakeEntry('t1', fingerprint)],
    ])

    expect(findChannelWithSameBot('chan-first', fingerprint, connections)).toBeNull()
  })

  it('allows a different bot to connect alongside', () => {
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-first', fakeEntry('t1', botTokenFingerprint('bot-a'))],
    ])

    expect(findChannelWithSameBot('chan-other', botTokenFingerprint('bot-b'), connections)).toBeNull()
  })

  it('ignores a dead session so a genuinely lost connection can be replaced', () => {
    const fingerprint = botTokenFingerprint('one-bot')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-first', fakeEntry('t1', fingerprint, false)],
    ])

    expect(findChannelWithSameBot('chan-second', fingerprint, connections)).toBeNull()
  })

  it('ignores entries recorded before fingerprints existed', () => {
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-legacy', fakeEntry('t1', undefined)],
    ])

    expect(findChannelWithSameBot('chan-new', botTokenFingerprint('bot-a'), connections)).toBeNull()
  })
})
