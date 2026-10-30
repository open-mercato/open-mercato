import {
  DISCORD_GATEWAY_INTENTS,
  GatewayOpcode,
  buildIdentifyPayload,
  buildResumePayload,
  buildHeartbeatPayload,
  computeReconnectDelayMs,
  createHeartbeatMonitor,
  isFatalGatewayCloseCode,
  shouldResumeAfterClose,
  getDiscordGatewayClient,
  type DiscordGatewayConnectOptions,
  type DiscordGatewayHandle,
  type GatewayResumeState,
  type GatewayWebSocketLike,
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

describe('createHeartbeatMonitor (zombie detection)', () => {
  it('sends the first beat and reconnects when the previous beat was never ACKed', () => {
    const monitor = createHeartbeatMonitor()
    expect(monitor.onBeat()).toBe('send') // first beat armed, awaiting ACK
    expect(monitor.onBeat()).toBe('reconnect') // no ACK arrived → zombie
  })

  it('keeps sending while ACKs arrive between beats', () => {
    const monitor = createHeartbeatMonitor()
    expect(monitor.onBeat()).toBe('send')
    monitor.onAck()
    expect(monitor.onBeat()).toBe('send')
    monitor.onAck()
    expect(monitor.onBeat()).toBe('send')
  })

  it('re-arms after reset (fresh reconnect)', () => {
    const monitor = createHeartbeatMonitor()
    expect(monitor.onBeat()).toBe('send')
    expect(monitor.onBeat()).toBe('reconnect')
    monitor.reset()
    expect(monitor.isAcked()).toBe(true)
    expect(monitor.onBeat()).toBe('send')
  })
})

type FakeSocket = {
  sent: string[]
  closes: Array<{ code?: number; reason?: string }>
  socket: GatewayWebSocketLike
  emit: (type: 'open' | 'message' | 'close' | 'error', event: unknown) => void
}

function createFakeSocket(): FakeSocket {
  const listeners: Partial<Record<'open' | 'message' | 'close' | 'error', Array<(event: unknown) => void>>> = {}
  const sent: string[] = []
  const closes: Array<{ code?: number; reason?: string }> = []
  return {
    sent,
    closes,
    socket: {
      send: (data: string) => {
        sent.push(data)
      },
      close: (code?: number, reason?: string) => {
        closes.push({ code, reason })
      },
      addEventListener: (type, listener) => {
        const bucket = listeners[type] ?? []
        bucket.push(listener)
        listeners[type] = bucket
      },
    },
    emit: (type, event) => {
      for (const listener of listeners[type] ?? []) listener(event)
    },
  }
}

function connectWithFakeSockets(
  sockets: FakeSocket[],
  overrides: Partial<DiscordGatewayConnectOptions> = {},
): { handle: DiscordGatewayHandle; resumeStates: GatewayResumeState[] } {
  const resumeStates: GatewayResumeState[] = []
  let index = 0
  const handle = getDiscordGatewayClient().connect({
    botToken: 'tok',
    resumeState: { sessionId: 'sess-1', sequence: 5, resumeGatewayUrl: 'wss://resume.example' },
    onMessage: jest.fn(),
    onReaction: jest.fn(),
    onReady: jest.fn(),
    onRequiresReauth: jest.fn(),
    onResumeStateChange: (state) => {
      resumeStates.push(state)
    },
    webSocketFactory: () => {
      const next = sockets[Math.min(index, sockets.length - 1)]
      index += 1
      return next.socket
    },
    ...overrides,
  })
  return { handle, resumeStates }
}

function firstOpcode(sent: string[]): number | undefined {
  const payload = sent.map((raw) => JSON.parse(raw) as { op: number }).find((entry) => entry.op !== GatewayOpcode.HEARTBEAT)
  return payload?.op
}

describe('gateway session — INVALID_SESSION (opcode 9)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('closes the socket so the connection reconnects instead of going deaf', () => {
    const socket = createFakeSocket()
    const { handle } = connectWithFakeSockets([socket])

    socket.emit('message', { data: JSON.stringify({ op: GatewayOpcode.INVALID_SESSION, d: false }) })

    expect(socket.closes).toEqual([{ code: 4000, reason: 'invalid session' }])
    handle.close()
  })

  it('re-IDENTIFYs on the next connect when Discord reports the session is not resumable', () => {
    const first = createFakeSocket()
    const second = createFakeSocket()
    const { handle, resumeStates } = connectWithFakeSockets([first, second])

    first.emit('message', { data: JSON.stringify({ op: GatewayOpcode.INVALID_SESSION, d: false }) })
    expect(resumeStates.at(-1)).toEqual({ sessionId: undefined, sequence: null, resumeGatewayUrl: undefined })

    first.emit('close', { code: 4000 })
    jest.advanceTimersByTime(30_000)
    second.emit('message', { data: JSON.stringify({ op: GatewayOpcode.HELLO, d: { heartbeat_interval: 45_000 } }) })

    expect(firstOpcode(second.sent)).toBe(GatewayOpcode.IDENTIFY)
    handle.close()
  })

  it('honours the resumable flag and RESUMEs the stored session when Discord allows it', () => {
    const first = createFakeSocket()
    const second = createFakeSocket()
    const { handle, resumeStates } = connectWithFakeSockets([first, second])

    first.emit('message', { data: JSON.stringify({ op: GatewayOpcode.INVALID_SESSION, d: true }) })
    expect(resumeStates).toEqual([])

    first.emit('close', { code: 4000 })
    jest.advanceTimersByTime(30_000)
    second.emit('message', { data: JSON.stringify({ op: GatewayOpcode.HELLO, d: { heartbeat_interval: 45_000 } }) })

    const resume = second.sent.map((raw) => JSON.parse(raw) as { op: number; d?: { session_id?: string } })
    expect(firstOpcode(second.sent)).toBe(GatewayOpcode.RESUME)
    expect(resume.find((entry) => entry.op === GatewayOpcode.RESUME)?.d?.session_id).toBe('sess-1')
    handle.close()
  })
})

describe('gateway handle — isActive()', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('stays active while the session reconnects, so a refresh never restarts it', () => {
    const first = createFakeSocket()
    const second = createFakeSocket()
    const { handle } = connectWithFakeSockets([first, second])

    expect(handle.isActive()).toBe(true)
    first.emit('close', { code: 1006 })
    expect(handle.isActive()).toBe(true)

    jest.advanceTimersByTime(30_000)
    handle.close()
  })

  it('reports inactive after close() and after a fatal close code', () => {
    const stopped = createFakeSocket()
    const { handle: stoppedHandle } = connectWithFakeSockets([stopped])
    stoppedHandle.close()
    expect(stoppedHandle.isActive()).toBe(false)

    const fatal = createFakeSocket()
    const { handle: fatalHandle } = connectWithFakeSockets([fatal])
    fatal.emit('close', { code: 4004 })
    expect(fatalHandle.isActive()).toBe(false)
  })
})
