/**
 * Thin Discord REST API client. Same trade-off as the Gmail provider's
 * `gmail-client.ts`: we call `fetch` directly (no `discord.js`) so the adapter
 * ships zero heavyweight runtime dependencies and stays swappable in tests via
 * `setDiscordRestClient(...)`.
 *
 * Only the endpoints the adapter actually uses are exposed:
 *   - createMessage   → POST   /channels/{id}/messages
 *   - editMessage     → PATCH  /channels/{id}/messages/{mid}
 *   - deleteMessage   → DELETE /channels/{id}/messages/{mid}
 *   - addReaction     → PUT    /channels/{id}/messages/{mid}/reactions/{emoji}/@me
 *   - removeReaction  → DELETE /channels/{id}/messages/{mid}/reactions/{emoji}/@me
 *   - listMessages    → GET    /channels/{id}/messages?before=
 *   - getCurrentUser  → GET    /users/@me
 *   - getGatewayBot   → GET    /gateway/bot
 *   - registerGuildCommands → PUT /applications/{app}/guilds/{guild}/commands
 */
import { fetchWithTimeout, FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'

export const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordAuth {
  botToken: string
}

export interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  bot?: boolean
  discriminator?: string
  avatar?: string | null
}

export interface DiscordMessageObject {
  id: string
  channel_id: string
  guild_id?: string
  content: string
  author: DiscordUser
  timestamp: string
  attachments?: Array<{ id: string; url: string; filename: string; content_type?: string; size?: number }>
  message_reference?: { message_id?: string; channel_id?: string; guild_id?: string }
  [key: string]: unknown
}

export interface CreateMessageInput {
  channelId: string
  content: string
  messageReferenceId?: string
  allowedMentions?: Record<string, unknown>
}

export interface GatewayBotResponse {
  url: string
  shards: number
  session_start_limit?: { total: number; remaining: number; reset_after: number; max_concurrency: number }
}

export interface DiscordRestClient {
  createMessage(auth: DiscordAuth, input: CreateMessageInput): Promise<DiscordMessageObject>
  editMessage(auth: DiscordAuth, channelId: string, messageId: string, content: string): Promise<DiscordMessageObject>
  deleteMessage(auth: DiscordAuth, channelId: string, messageId: string): Promise<void>
  addReaction(auth: DiscordAuth, channelId: string, messageId: string, emoji: string): Promise<void>
  removeReaction(auth: DiscordAuth, channelId: string, messageId: string, emoji: string): Promise<void>
  listMessages(
    auth: DiscordAuth,
    channelId: string,
    input: { before?: string; limit?: number },
  ): Promise<DiscordMessageObject[]>
  getCurrentUser(auth: DiscordAuth): Promise<DiscordUser>
  getGatewayBot(auth: DiscordAuth): Promise<GatewayBotResponse>
  registerGuildCommands(
    auth: DiscordAuth,
    applicationId: string,
    guildId: string,
    commands: Array<Record<string, unknown>>,
  ): Promise<void>
}

export class DiscordApiError extends Error {
  readonly status: number
  readonly detail: string
  constructor(message: string, status: number, detail: string) {
    super(message)
    this.name = 'DiscordApiError'
    this.status = status
    this.detail = detail
  }
}

const DISCORD_MAX_RETRIES = 3
const DISCORD_BACKOFF_BASE_MS = 500
const DISCORD_BACKOFF_CAP_MS = 8_000
const DISCORD_DEFAULT_REQUEST_TIMEOUT_MS = 15_000

function resolveRequestTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.OM_CHANNEL_DISCORD_REQUEST_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DISCORD_DEFAULT_REQUEST_TIMEOUT_MS
}

/**
 * Discord emoji path encoding: unicode emoji is URL-encoded as-is; a custom
 * emoji uses the `name:id` form. We pass through the caller's value and only
 * `encodeURIComponent` it so both forms survive.
 */
function encodeEmoji(emoji: string): string {
  return encodeURIComponent(emoji)
}

class FetchDiscordRestClient implements DiscordRestClient {
  async createMessage(auth: DiscordAuth, input: CreateMessageInput): Promise<DiscordMessageObject> {
    const body: Record<string, unknown> = {
      content: input.content,
      allowed_mentions: input.allowedMentions ?? { parse: [] },
    }
    if (input.messageReferenceId) {
      body.message_reference = { message_id: input.messageReferenceId }
    }
    return this.request<DiscordMessageObject>(
      auth,
      'POST',
      `/channels/${encodeURIComponent(input.channelId)}/messages`,
      body,
    )
  }

  async editMessage(
    auth: DiscordAuth,
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<DiscordMessageObject> {
    return this.request<DiscordMessageObject>(
      auth,
      'PATCH',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      { content },
    )
  }

  async deleteMessage(auth: DiscordAuth, channelId: string, messageId: string): Promise<void> {
    await this.request<void>(
      auth,
      'DELETE',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    )
  }

  async addReaction(auth: DiscordAuth, channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request<void>(
      auth,
      'PUT',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}/@me`,
    )
  }

  async removeReaction(auth: DiscordAuth, channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request<void>(
      auth,
      'DELETE',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}/@me`,
    )
  }

  async listMessages(
    auth: DiscordAuth,
    channelId: string,
    input: { before?: string; limit?: number },
  ): Promise<DiscordMessageObject[]> {
    const search = new URLSearchParams()
    if (input.before) search.set('before', input.before)
    search.set('limit', String(Math.min(Math.max(input.limit ?? 50, 1), 100)))
    const query = search.toString()
    return this.request<DiscordMessageObject[]>(
      auth,
      'GET',
      `/channels/${encodeURIComponent(channelId)}/messages?${query}`,
    )
  }

  async getCurrentUser(auth: DiscordAuth): Promise<DiscordUser> {
    return this.request<DiscordUser>(auth, 'GET', '/users/@me')
  }

  async getGatewayBot(auth: DiscordAuth): Promise<GatewayBotResponse> {
    return this.request<GatewayBotResponse>(auth, 'GET', '/gateway/bot')
  }

  async registerGuildCommands(
    auth: DiscordAuth,
    applicationId: string,
    guildId: string,
    commands: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.request<unknown>(
      auth,
      'PUT',
      `/applications/${encodeURIComponent(applicationId)}/guilds/${encodeURIComponent(guildId)}/commands`,
      commands,
    )
  }

  private async request<T>(
    auth: DiscordAuth,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${DISCORD_API_BASE}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bot ${auth.botToken}`,
    }
    let payload: BodyInit | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    let attempt = 0
    let lastError: DiscordApiError | null = null
    while (attempt <= DISCORD_MAX_RETRIES) {
      let res: Response
      try {
        res = await fetchWithTimeout(url, { method, headers, body: payload, timeoutMs: resolveRequestTimeoutMs() })
      } catch (err) {
        const errName = (err as { name?: unknown } | null)?.name
        const aborted = err instanceof FetchTimeoutError || errName === 'TimeoutError' || errName === 'AbortError'
        if (!aborted) throw err
        const timeoutError = new DiscordApiError(`Discord API ${method} ${path} timed out`, 599, 'request timed out')
        if (attempt === DISCORD_MAX_RETRIES) throw timeoutError
        lastError = timeoutError
        await sleep(computeBackoff(attempt))
        attempt += 1
        continue
      }

      const text = await res.text()
      if (res.ok) {
        if (!text) return undefined as unknown as T
        return JSON.parse(text) as T
      }

      const detail = parseErrorMessage(text) ?? `${res.status} ${res.statusText}`
      const apiError = new DiscordApiError(`Discord API ${method} ${path} failed: ${detail}`, res.status, detail)
      const transient = res.status === 429 || (res.status >= 500 && res.status < 600)
      if (!transient || attempt === DISCORD_MAX_RETRIES) {
        throw apiError
      }
      lastError = apiError
      const waitMs = parseRetryAfter(res.headers.get('retry-after')) ?? computeBackoff(attempt)
      await sleep(waitMs)
      attempt += 1
    }
    throw lastError ?? new DiscordApiError(`Discord API ${method} ${path} exhausted retries`, 599, 'retries exhausted')
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, DISCORD_BACKOFF_CAP_MS)
  }
  return null
}

function computeBackoff(attempt: number): number {
  const raw = DISCORD_BACKOFF_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 100)
  return Math.min(raw + jitter, DISCORD_BACKOFF_CAP_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseErrorMessage(text: string): string | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string }
    if (typeof parsed?.message === 'string') return parsed.message
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    /* fall through */
  }
  return text.length > 200 ? text.slice(0, 200) : text
}

let cachedClient: DiscordRestClient | null = null

export function getDiscordRestClient(): DiscordRestClient {
  if (!cachedClient) cachedClient = new FetchDiscordRestClient()
  return cachedClient
}

export function setDiscordRestClient(client: DiscordRestClient | null): void {
  cachedClient = client
}
