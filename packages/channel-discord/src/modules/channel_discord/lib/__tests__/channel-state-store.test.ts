import { mergeDiscordChannelState } from '../channel-state-store'

const NOW = new Date('2026-07-31T10:00:00.000Z')

describe('mergeDiscordChannelState', () => {
  it('writes the gateway keys and stamps lastConnectedAt', () => {
    const merged = mergeDiscordChannelState(
      {},
      { sessionId: 'sess-1', sequence: 10, resumeGatewayUrl: 'wss://resume', botUserId: 'bot-1' },
      NOW,
    )

    expect(merged).toEqual({
      sessionId: 'sess-1',
      sequence: 10,
      resumeGatewayUrl: 'wss://resume',
      botUserId: 'bot-1',
      lastConnectedAt: NOW.toISOString(),
    })
  })

  it('carries operator-owned keys forward instead of clobbering them', () => {
    const merged = mergeDiscordChannelState(
      { aiAutoReplyEnabled: true, aiAgentId: 'agent-7', sessionId: 'sess-0', sequence: 3 },
      { sessionId: 'sess-1', sequence: 4 },
      NOW,
    )

    expect(merged?.aiAutoReplyEnabled).toBe(true)
    expect(merged?.aiAgentId).toBe('agent-7')
    expect(merged?.sessionId).toBe('sess-1')
  })

  it('drops a patch that would rewind the sequence of the session already stored', () => {
    const merged = mergeDiscordChannelState(
      { sessionId: 'sess-1', sequence: 42 },
      { sessionId: 'sess-1', sequence: 7 },
      NOW,
    )

    expect(merged).toBeNull()
  })

  it('accepts a lower sequence when the session itself changed (fresh identify)', () => {
    const merged = mergeDiscordChannelState(
      { sessionId: 'sess-1', sequence: 42 },
      { sessionId: 'sess-2', sequence: 1 },
      NOW,
    )

    expect(merged?.sessionId).toBe('sess-2')
    expect(merged?.sequence).toBe(1)
  })

  it('accepts an equal sequence (a re-READY of the same session)', () => {
    const merged = mergeDiscordChannelState(
      { sessionId: 'sess-1', sequence: 42 },
      { sessionId: 'sess-1', sequence: 42, botUserId: 'bot-1' },
      NOW,
    )

    expect(merged?.botUserId).toBe('bot-1')
  })
})
