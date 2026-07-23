import {
  DISCORD_GATEWAY_INTENTS,
  GatewayOpcode,
  buildIdentifyPayload,
  buildResumePayload,
  buildHeartbeatPayload,
  computeReconnectDelayMs,
  isFatalGatewayCloseCode,
  shouldResumeAfterClose,
} from '../discord-gateway-client'

describe('discord gateway state-machine helpers', () => {
  it('declares message-content + guild-message intents', () => {
    // GUILDS (1) | GUILD_MESSAGES (512) | GUILD_MESSAGE_REACTIONS (1024) | MESSAGE_CONTENT (32768)
    expect(DISCORD_GATEWAY_INTENTS).toBe(1 | 512 | 1024 | 32768)
  })

  it('builds an identify payload with the bot token + intents', () => {
    const payload = buildIdentifyPayload('tok', DISCORD_GATEWAY_INTENTS)
    expect(payload.op).toBe(GatewayOpcode.IDENTIFY)
    expect(payload.d.token).toBe('tok')
    expect(payload.d.intents).toBe(DISCORD_GATEWAY_INTENTS)
  })

  it('builds a resume payload with session + sequence', () => {
    const payload = buildResumePayload('tok', 'sess-1', 42)
    expect(payload.op).toBe(GatewayOpcode.RESUME)
    expect(payload.d).toEqual({ token: 'tok', session_id: 'sess-1', seq: 42 })
  })

  it('builds a heartbeat payload with the last sequence', () => {
    expect(buildHeartbeatPayload(7)).toEqual({ op: GatewayOpcode.HEARTBEAT, d: 7 })
    expect(buildHeartbeatPayload(null)).toEqual({ op: GatewayOpcode.HEARTBEAT, d: null })
  })

  it('treats 4004/4014 as fatal (requires reauth)', () => {
    expect(isFatalGatewayCloseCode(4004)).toBe(true)
    expect(isFatalGatewayCloseCode(4014)).toBe(true)
    expect(isFatalGatewayCloseCode(1006)).toBe(false)
    expect(isFatalGatewayCloseCode(undefined)).toBe(false)
  })

  it('does not resume after fatal / session-invalidating close codes', () => {
    expect(shouldResumeAfterClose(4004)).toBe(false)
    expect(shouldResumeAfterClose(4007)).toBe(false)
    expect(shouldResumeAfterClose(4009)).toBe(false)
    expect(shouldResumeAfterClose(1000)).toBe(false)
    expect(shouldResumeAfterClose(1006)).toBe(true)
  })

  it('bounds reconnect backoff between base and cap', () => {
    expect(computeReconnectDelayMs(0)).toBeGreaterThanOrEqual(1000)
    expect(computeReconnectDelayMs(0)).toBeLessThanOrEqual(1500)
    expect(computeReconnectDelayMs(100)).toBeLessThanOrEqual(30_000)
  })
})
