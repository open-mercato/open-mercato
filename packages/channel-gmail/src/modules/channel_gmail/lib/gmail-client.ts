/**
 * Thin Gmail REST API wrapper. Same trade-off as `oauth.ts`: we use `fetch`
 * directly so the adapter doesn't import the `googleapis` SDK at runtime in
 * environments that don't need it (tests, build-only checks). Production code
 * paths still allow swapping to the SDK via `setGmailApiClient(...)` if a
 * downstream package wants the SDK's extra ergonomics.
 *
 * Only the endpoints the adapter actually calls are exposed:
 *   - listHistory      → gmail.users.history.list
 *   - listMessages     → gmail.users.messages.list (fallback when historyId expired)
 *   - getMessageRaw    → gmail.users.messages.get?format=raw
 *   - sendRawMessage   → gmail.users.messages.send
 *   - getProfile       → gmail.users.getProfile (health + initial historyId)
 *   - deleteMessage    → gmail.users.messages.trash (move to trash; matches `deleteMessage: true` capability)
 */

import { fetchWithTimeout, FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'

export interface GmailApiAuth {
  accessToken: string
}

export interface GmailHistoryListInput {
  startHistoryId: string
  /** Optional page token for paging through history results. */
  pageToken?: string
  /** Optional label filter; defaults to INBOX-only changes. */
  labelId?: string
}

export interface GmailHistoryRecord {
  id: string
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>
  labelsAdded?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>
  labelsRemoved?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>
}

export interface GmailHistoryListResponse {
  history?: GmailHistoryRecord[]
  nextPageToken?: string
  historyId: string
}

export interface GmailMessagesListInput {
  query?: string
  labelIds?: string[]
  pageToken?: string
  maxResults?: number
}

export interface GmailMessagesListResponse {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailGetMessageRawResponse {
  id: string
  threadId: string
  labelIds?: string[]
  /** Base64URL-encoded RFC2822 message. */
  raw: string
  internalDate?: string
  sizeEstimate?: number
}

export interface GmailSendRawInput {
  /** Base64URL-encoded RFC2822 message body. */
  rawBase64Url: string
  /** Optional thread to attach to. */
  threadId?: string
}

export interface GmailSendResponse {
  id: string
  threadId: string
  labelIds?: string[]
}

export interface GmailProfileResponse {
  emailAddress: string
  messagesTotal?: number
  threadsTotal?: number
  historyId: string
}

export interface GmailWatchInput {
  /** Fully-qualified Pub/Sub topic, e.g. `projects/myproj/topics/gmail-inbound`. */
  topicName: string
  /** Defaults to `['INBOX']` so only inbox changes generate notifications. */
  labelIds?: string[]
  /** `include` (default) or `exclude`. */
  labelFilterAction?: 'include' | 'exclude'
}

export interface GmailWatchResponse {
  historyId: string
  /** Watch expiration timestamp, ms since epoch. Gmail caps at ~7 days. */
  expiration: string
}

export interface GmailApiClient {
  listHistory(auth: GmailApiAuth, input: GmailHistoryListInput): Promise<GmailHistoryListResponse>
  listMessages(auth: GmailApiAuth, input: GmailMessagesListInput): Promise<GmailMessagesListResponse>
  getMessageRaw(auth: GmailApiAuth, messageId: string): Promise<GmailGetMessageRawResponse>
  sendRawMessage(auth: GmailApiAuth, input: GmailSendRawInput): Promise<GmailSendResponse>
  getProfile(auth: GmailApiAuth): Promise<GmailProfileResponse>
  trashMessage(auth: GmailApiAuth, messageId: string): Promise<void>
  /** Spec C — `gmail.users.watch` registers a Pub/Sub topic for push delivery. */
  watchInbox(auth: GmailApiAuth, input: GmailWatchInput): Promise<GmailWatchResponse>
  /** Spec C — `gmail.users.stop` tears down the Pub/Sub registration. */
  stopWatch(auth: GmailApiAuth): Promise<void>
}

const GMAIL_MAX_RETRIES = 3
const GMAIL_BACKOFF_BASE_MS = 500
const GMAIL_BACKOFF_CAP_MS = 8_000
const GMAIL_DEFAULT_REQUEST_TIMEOUT_MS = 30_000

function resolveGmailRequestTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.OM_CHANNEL_GMAIL_REQUEST_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : GMAIL_DEFAULT_REQUEST_TIMEOUT_MS
}

class FetchGmailApiClient implements GmailApiClient {
  async listHistory(auth: GmailApiAuth, input: GmailHistoryListInput): Promise<GmailHistoryListResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/history`)
    url.searchParams.set('startHistoryId', input.startHistoryId)
    if (input.pageToken) url.searchParams.set('pageToken', input.pageToken)
    url.searchParams.set('labelId', input.labelId ?? 'INBOX')
    url.searchParams.set('historyTypes', 'messageAdded')
    return this.requestJson<GmailHistoryListResponse>(auth, url, 'GET')
  }

  async listMessages(auth: GmailApiAuth, input: GmailMessagesListInput): Promise<GmailMessagesListResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages`)
    if (input.query) url.searchParams.set('q', input.query)
    for (const label of input.labelIds ?? []) url.searchParams.append('labelIds', label)
    if (input.pageToken) url.searchParams.set('pageToken', input.pageToken)
    if (input.maxResults) url.searchParams.set('maxResults', String(input.maxResults))
    return this.requestJson<GmailMessagesListResponse>(auth, url, 'GET')
  }

  async getMessageRaw(auth: GmailApiAuth, messageId: string): Promise<GmailGetMessageRawResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}`)
    url.searchParams.set('format', 'raw')
    return this.requestJson<GmailGetMessageRawResponse>(auth, url, 'GET')
  }

  async sendRawMessage(auth: GmailApiAuth, input: GmailSendRawInput): Promise<GmailSendResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/send`)
    return this.requestJson<GmailSendResponse>(auth, url, 'POST', {
      raw: input.rawBase64Url,
      threadId: input.threadId,
    })
  }

  async getProfile(auth: GmailApiAuth): Promise<GmailProfileResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/profile`)
    return this.requestJson<GmailProfileResponse>(auth, url, 'GET')
  }

  async trashMessage(auth: GmailApiAuth, messageId: string): Promise<void> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}/trash`)
    await this.requestJson(auth, url, 'POST')
  }

  async watchInbox(auth: GmailApiAuth, input: GmailWatchInput): Promise<GmailWatchResponse> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/watch`)
    return this.requestJson<GmailWatchResponse>(auth, url, 'POST', {
      topicName: input.topicName,
      labelIds: input.labelIds ?? ['INBOX'],
      labelFilterAction: input.labelFilterAction ?? 'include',
    })
  }

  async stopWatch(auth: GmailApiAuth): Promise<void> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/stop`)
    await this.requestJson(auth, url, 'POST')
  }

  private async requestJson<T>(auth: GmailApiAuth, url: URL, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
    }
    let payload: BodyInit | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    // Retry transient failures (429, 5xx) with exponential backoff + jitter,
    // honoring `Retry-After` when present. Per Gmail API docs at
    // https://developers.google.com/gmail/api/guides/handle-errors this is the
    // documented mitigation for rate-limit + server-side transient errors.
    let attempt = 0
    let lastError: GmailApiError | null = null
    while (attempt <= GMAIL_MAX_RETRIES) {
      let res: Response
      try {
        res = await fetchWithTimeout(url.toString(), {
          method,
          headers,
          body: payload,
          // Bound each attempt so a stalled connection fails fast instead of
          // hanging on undici's multi-minute default and pinning the worker slot.
          timeoutMs: resolveGmailRequestTimeoutMs(),
        })
      } catch (err) {
        // A timed-out/aborted connection is transient — let the bounded retry
        // loop retry it rather than propagating a raw error. `fetchWithTimeout`
        // surfaces an elapsed timeout as `FetchTimeoutError`; an externally-aborted
        // request still surfaces as an `AbortError` DOMException. Match the
        // `FetchTimeoutError` type and the abort `name` field (DOMException does
        // not subclass Error across realms) — treat both as transient.
        const errName = (err as { name?: unknown } | null)?.name
        const aborted = err instanceof FetchTimeoutError || errName === 'TimeoutError' || errName === 'AbortError'
        if (!aborted) throw err
        const timeoutError = new GmailApiError(
          `Gmail API ${method} ${url.pathname} timed out`,
          599,
          'request timed out',
        )
        if (attempt === GMAIL_MAX_RETRIES) throw timeoutError
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
      const apiError = new GmailApiError(
        `Gmail API ${method} ${url.pathname} failed: ${detail}`,
        res.status,
        detail,
      )
      const transient =
        res.status === 429 ||
        (res.status >= 500 && res.status < 600) ||
        // Gmail signals per-user/project quota exhaustion with HTTP 403 +
        // `rateLimitExceeded`/`userRateLimitExceeded` (not only 429).
        (res.status === 403 && isRateLimit403(text))
      if (!transient || attempt === GMAIL_MAX_RETRIES) {
        throw apiError
      }
      lastError = apiError
      const retryAfterHeader = res.headers.get('retry-after')
      const waitMs =
        parseRetryAfter(retryAfterHeader) ?? computeBackoff(attempt)
      await sleep(waitMs)
      attempt += 1
    }
    throw lastError ?? new GmailApiError(`Gmail API ${method} ${url.pathname} exhausted retries`, 599, 'retries exhausted')
  }
}

/**
 * Gmail signals quota exhaustion with HTTP 403 + an error reason of
 * `rateLimitExceeded` / `userRateLimitExceeded` (not only 429). Treat those as
 * transient so the backoff/retry path applies; a genuine permission 403 (no
 * rate-limit reason) stays non-retryable.
 */
function isRateLimit403(body: string): boolean {
  return /rateLimitExceeded|userRateLimitExceeded/i.test(body)
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, GMAIL_BACKOFF_CAP_MS)
  }
  const asDate = Date.parse(value)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta > 0) return Math.min(delta, GMAIL_BACKOFF_CAP_MS)
  }
  return null
}

function computeBackoff(attempt: number): number {
  const raw = GMAIL_BACKOFF_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 100)
  return Math.min(raw + jitter, GMAIL_BACKOFF_CAP_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class GmailApiError extends Error {
  readonly status: number
  readonly detail: string
  constructor(message: string, status: number, detail: string) {
    super(message)
    this.name = 'GmailApiError'
    this.status = status
    this.detail = detail
  }
}

function parseErrorMessage(text: string): string | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string }
    if (parsed && typeof parsed.error === 'object' && parsed.error && typeof parsed.error.message === 'string') {
      return parsed.error.message
    }
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    /* fall through */
  }
  return text.length > 200 ? text.slice(0, 200) : text
}

let cachedClient: GmailApiClient | null = null

export function getGmailApiClient(): GmailApiClient {
  if (!cachedClient) cachedClient = new FetchGmailApiClient()
  return cachedClient
}

export function setGmailApiClient(client: GmailApiClient | null): void {
  cachedClient = client
}

/** Encode an RFC2822 message buffer to base64url as required by gmail.users.messages.send. */
export function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode a base64url payload (e.g. `gmail.users.messages.get?format=raw`) to a buffer. */
export function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}
