import type { DiscordMessageObject } from './discord-rest'

/**
 * Discord Gateway (WebSocket) client. Uses the Node >= 22 built-in global
 * `WebSocket` — no `ws` dependency. The network-touching class only opens a
 * socket when `connect()` is called, so importing this module has no side
 * effects; the state-machine helpers below are pure and unit-tested.
 *
 * Swappable in tests / alternate transports via `setDiscordGatewayClient(...)`.
 */

// ── Gateway opcodes ───────────────────────────────────────────
export const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

// ── Gateway intents (bitfield) ────────────────────────────────
const INTENT_GUILDS = 1 << 0
const INTENT_GUILD_MESSAGES = 1 << 9
const INTENT_GUILD_MESSAGE_REACTIONS = 1 << 10
const INTENT_MESSAGE_CONTENT = 1 << 15

/**
 * Default intents the bot identifies with: guild lifecycle, guild message
 * create/reactions, and (privileged) message content so inbound text is
 * readable. `DIRECT_MESSAGES` is intentionally omitted for the first release.
 */
export const DISCORD_GATEWAY_INTENTS =
  INTENT_GUILDS | INTENT_GUILD_MESSAGES | INTENT_GUILD_MESSAGE_REACTIONS | INTENT_MESSAGE_CONTENT

export const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

/**
 * Fatal close codes: the bot token or intents are wrong and reconnecting will
 * not help. The worker surfaces these as `requires_reauth` instead of looping.
 * 4004 Authentication failed, 4014 Disallowed intents.
 */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014])

export function isFatalGatewayCloseCode(code: number | undefined): boolean {
  return typeof code === 'number' && FATAL_CLOSE_CODES.has(code)
}

/**
 * Whether a close code invalidates the current session so the next connect must
 * re-`IDENTIFY` (fresh session) rather than `RESUME`. 4007 (invalid seq) and
 * 4009 (session timed out) require a fresh identify.
 */
export function shouldResumeAfterClose(code: number | undefined): boolean {
  if (code === undefined) return true
  if (isFatalGatewayCloseCode(code)) return false
  return code !== 4007 && code !== 4009 && code !== 1000 && code !== 1001
}

/**
 * Heartbeat/ACK zombie detector. Discord expects a Heartbeat ACK (opcode 11)
 * after every heartbeat we send; a missing ACK before the next heartbeat means
 * the connection is a zombie (TCP up, gateway dead) and MUST be torn down +
 * reconnected rather than left silently deaf. Pure + unit-testable.
 *
 * Contract: call `onBeat()` on each heartbeat-interval tick — it returns
 * `'reconnect'` when the previous beat was never acked, else `'send'` (and marks
 * the new beat pending). Call `onAck()` on opcode 11. `reset()` re-arms after a
 * fresh (re)connect.
 */
export function createHeartbeatMonitor() {
  let acked = true
  return {
    onBeat(): 'send' | 'reconnect' {
      if (!acked) return 'reconnect'
      acked = false
      return 'send'
    },
    onAck(): void {
      acked = true
    },
    reset(): void {
      acked = true
    },
    isAcked(): boolean {
      return acked
    },
  }
}

export type HeartbeatMonitor = ReturnType<typeof createHeartbeatMonitor>

/** Exponential backoff with jitter, capped, for reconnect attempts. */
export function computeReconnectDelayMs(attempt: number): number {
  const base = 1000 * Math.pow(2, Math.min(attempt, 5))
  const jitter = Math.floor(Math.random() * 500)
  return Math.min(base + jitter, 30_000)
}

export interface IdentifyPayload {
  op: number
  d: {
    token: string
    intents: number
    properties: { os: string; browser: string; device: string }
  }
}

export function buildIdentifyPayload(botToken: string, intents: number = DISCORD_GATEWAY_INTENTS): IdentifyPayload {
  return {
    op: GatewayOpcode.IDENTIFY,
    d: {
      token: botToken,
      intents,
      properties: { os: 'linux', browser: 'open-mercato', device: 'open-mercato' },
    },
  }
}

export interface ResumePayload {
  op: number
  d: { token: string; session_id: string; seq: number | null }
}

export function buildResumePayload(botToken: string, sessionId: string, seq: number | null): ResumePayload {
  return {
    op: GatewayOpcode.RESUME,
    d: { token: botToken, session_id: sessionId, seq },
  }
}

export function buildHeartbeatPayload(seq: number | null): { op: number; d: number | null } {
  return { op: GatewayOpcode.HEARTBEAT, d: seq }
}

// ── Connection interface ──────────────────────────────────────

export interface GatewayResumeState {
  sessionId?: string
  sequence?: number | null
  resumeGatewayUrl?: string
}

export interface DiscordGatewayConnectOptions {
  botToken: string
  intents?: number
  resumeState?: GatewayResumeState
  /** Called for each `MESSAGE_CREATE` dispatch. */
  onMessage: (message: DiscordMessageObject) => void | Promise<void>
  /** Called for each `MESSAGE_REACTION_ADD` / `_REMOVE` dispatch. */
  onReaction: (reaction: Record<string, unknown>, action: 'added' | 'removed') => void | Promise<void>
  /** Called on READY with the bot's own user id + fresh resume state. */
  onReady: (info: { botUserId: string; resumeState: GatewayResumeState }) => void | Promise<void>
  /** Called on a fatal auth/intents close code (4004/4014). */
  onRequiresReauth: (info: { code: number }) => void | Promise<void>
  /** Optional persisted resume-state updates (session id + sequence). */
  onResumeStateChange?: (resumeState: GatewayResumeState) => void
  /** Injected WebSocket factory for tests; defaults to global `WebSocket`. */
  webSocketFactory?: (url: string) => GatewayWebSocketLike
}

export interface GatewayWebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void
}

export interface DiscordGatewayHandle {
  /** Close the socket and stop reconnecting. */
  close(): void
}

export interface DiscordGatewayClient {
  connect(options: DiscordGatewayConnectOptions): DiscordGatewayHandle
}

/**
 * Native-WebSocket-backed gateway connection. Handles the HELLO→IDENTIFY/RESUME
 * handshake, heartbeat with sequence tracking, dispatch fan-out, and
 * reconnect-with-backoff. One instance owns exactly one socket.
 */
class NativeDiscordGatewayClient implements DiscordGatewayClient {
  connect(options: DiscordGatewayConnectOptions): DiscordGatewayHandle {
    const connection = new GatewaySession(options)
    connection.open()
    return { close: () => connection.stop() }
  }
}

class GatewaySession {
  private ws: GatewayWebSocketLike | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly heartbeat = createHeartbeatMonitor()
  private sequence: number | null = null
  private sessionId: string | undefined
  private resumeGatewayUrl: string | undefined
  private stopped = false
  private attempt = 0

  constructor(private readonly options: DiscordGatewayConnectOptions) {
    this.sequence = options.resumeState?.sequence ?? null
    this.sessionId = options.resumeState?.sessionId
    this.resumeGatewayUrl = options.resumeState?.resumeGatewayUrl
  }

  open(): void {
    if (this.stopped) return
    const url = this.canResume() ? `${this.resumeGatewayUrl}?v=10&encoding=json` : DISCORD_GATEWAY_URL
    const factory = this.options.webSocketFactory ?? defaultWebSocketFactory
    const ws = factory(url)
    this.ws = ws
    ws.addEventListener('message', (event) => this.onMessage(event))
    ws.addEventListener('close', (event) => this.onClose(event))
    ws.addEventListener('error', () => {
      /* the close handler drives reconnect; errors are logged by the worker */
    })
  }

  stop(): void {
    this.stopped = true
    this.clearHeartbeat()
    try {
      this.ws?.close(1000, 'client stop')
    } catch {
      /* ignore */
    }
    this.ws = null
  }

  private canResume(): boolean {
    return Boolean(this.sessionId && this.resumeGatewayUrl)
  }

  private onMessage(event: unknown): void {
    const data = (event as { data?: unknown })?.data
    if (typeof data !== 'string') return
    let payload: { op: number; d?: unknown; s?: number | null; t?: string | null }
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (typeof payload.s === 'number') {
      this.sequence = payload.s
      this.options.onResumeStateChange?.({
        sessionId: this.sessionId,
        sequence: this.sequence,
        resumeGatewayUrl: this.resumeGatewayUrl,
      })
    }

    switch (payload.op) {
      case GatewayOpcode.HELLO: {
        const interval = (payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 41250
        this.startHeartbeat(interval)
        if (this.canResume()) {
          this.sendJson(buildResumePayload(this.options.botToken, this.sessionId as string, this.sequence))
        } else {
          this.sendJson(buildIdentifyPayload(this.options.botToken, this.options.intents ?? DISCORD_GATEWAY_INTENTS))
        }
        break
      }
      case GatewayOpcode.HEARTBEAT: {
        // Server-requested immediate heartbeat.
        this.sendJson(buildHeartbeatPayload(this.sequence))
        break
      }
      case GatewayOpcode.HEARTBEAT_ACK: {
        this.heartbeat.onAck()
        break
      }
      case GatewayOpcode.INVALID_SESSION: {
        // Discord tells us whether the session is resumable via `d` (boolean).
        this.sessionId = undefined
        this.resumeGatewayUrl = undefined
        break
      }
      case GatewayOpcode.RECONNECT: {
        try {
          this.ws?.close(4000, 'server requested reconnect')
        } catch {
          /* the close handler reconnects */
        }
        break
      }
      case GatewayOpcode.DISPATCH: {
        this.attempt = 0
        void this.onDispatch(payload.t ?? '', payload.d)
        break
      }
      default:
        break
    }
  }

  private async onDispatch(type: string, data: unknown): Promise<void> {
    if (type === 'READY') {
      const ready = data as { session_id?: string; resume_gateway_url?: string; user?: { id?: string } }
      this.sessionId = ready.session_id
      this.resumeGatewayUrl = ready.resume_gateway_url
      const resumeState: GatewayResumeState = {
        sessionId: this.sessionId,
        sequence: this.sequence,
        resumeGatewayUrl: this.resumeGatewayUrl,
      }
      this.options.onResumeStateChange?.(resumeState)
      await this.options.onReady({ botUserId: ready.user?.id ?? '', resumeState })
      return
    }
    if (type === 'MESSAGE_CREATE') {
      await this.options.onMessage(data as DiscordMessageObject)
      return
    }
    if (type === 'MESSAGE_REACTION_ADD') {
      await this.options.onReaction(data as Record<string, unknown>, 'added')
      return
    }
    if (type === 'MESSAGE_REACTION_REMOVE') {
      await this.options.onReaction(data as Record<string, unknown>, 'removed')
      return
    }
  }

  private onClose(event: unknown): void {
    this.clearHeartbeat()
    const code = (event as { code?: number })?.code
    if (isFatalGatewayCloseCode(code)) {
      void this.options.onRequiresReauth({ code: code as number })
      this.stopped = true
      return
    }
    if (!shouldResumeAfterClose(code)) {
      this.sessionId = undefined
      this.resumeGatewayUrl = undefined
    }
    if (this.stopped) return
    const delay = computeReconnectDelayMs(this.attempt)
    this.attempt += 1
    setTimeout(() => this.open(), delay)
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat()
    this.heartbeat.reset()
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeat.onBeat() === 'reconnect') {
        // Previous heartbeat was never ACKed → zombie connection. Force a close
        // so the close handler reconnects (with resume) instead of staying deaf.
        this.clearHeartbeat()
        try {
          this.ws?.close(4000, 'heartbeat ack timeout')
        } catch {
          /* the close handler reconnects */
        }
        return
      }
      this.sendJson(buildHeartbeatPayload(this.sequence))
    }, intervalMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendJson(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload))
    } catch {
      /* the close handler drives reconnect */
    }
  }
}

function defaultWebSocketFactory(url: string): GatewayWebSocketLike {
  const globalWebSocket = (globalThis as { WebSocket?: new (url: string) => GatewayWebSocketLike }).WebSocket
  if (!globalWebSocket) {
    throw new Error('[internal] global WebSocket is unavailable — Node >= 22 is required for the Discord gateway worker')
  }
  return new globalWebSocket(url)
}

let cachedClient: DiscordGatewayClient | null = null

export function getDiscordGatewayClient(): DiscordGatewayClient {
  if (!cachedClient) cachedClient = new NativeDiscordGatewayClient()
  return cachedClient
}

export function setDiscordGatewayClient(client: DiscordGatewayClient | null): void {
  cachedClient = client
}
