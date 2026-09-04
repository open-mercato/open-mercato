/**
 * Thin Microsoft Graph mail wrapper. Same trade-off as `oauth.ts`: raw `fetch`
 * so the adapter carries no Graph SDK, and a `setGraphMailClient(...)` hook so
 * tests never touch the network.
 *
 * Only the endpoints the adapter calls are exposed:
 *   - startInboxDelta / continueDelta   → /me/mailFolders/inbox/messages/delta
 *   - listInboxMessages / continueList  → /me/mailFolders/inbox/messages (historical import)
 *   - getMessageMime                    → /me/messages/{id}/$value (raw RFC2822)
 *   - findMessageIdByInternetMessageId  → /me/messages?$filter=internetMessageId eq …
 *   - createDraftFromMime               → POST /me/messages (text/plain, base64 MIME)
 *   - sendDraft                         → POST /me/messages/{id}/send
 *   - deleteMessage                     → DELETE /me/messages/{id} (orphan draft cleanup)
 *   - moveMessage                       → POST /me/messages/{id}/move (soft delete)
 *
 * Every call sends `Prefer: IdType="ImmutableId"` so message ids survive folder
 * moves (spec D5). Delta/list calls add `odata.maxpagesize` for the page size.
 */

import { fetchWithTimeout, FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { resolveGraphBaseUrl } from './oauth'

export interface GraphAuth {
  accessToken: string
}

/** Projection we ask for on delta + list responses (`$select`). */
export const GRAPH_MESSAGE_SELECT = 'id,internetMessageId,receivedDateTime,isDraft,conversationId'

export interface GraphMessageStub {
  id: string
  internetMessageId?: string
  /** ISO 8601 — server clock, used for the ingest watermark. */
  receivedDateTime?: string
  isDraft?: boolean
  conversationId?: string
  /** Present on delta tombstones (`{"reason":"deleted"}`). */
  '@removed'?: { reason?: string }
}

export interface GraphDeltaPage {
  value: GraphMessageStub[]
  nextLink?: string
  deltaLink?: string
}

export interface GraphListPage {
  value: GraphMessageStub[]
  nextLink?: string
  /** `@odata.count` when `includeCount` was requested and Graph honoured it. */
  count?: number
}

export interface GraphStartDeltaInput {
  /** Initial-request `$filter=receivedDateTime ge {value}`; omit for the full folder. */
  receivedSince?: Date
  pageSize?: number
}

export interface GraphListInboxInput {
  /** Raw OData `$filter` expression (built by the adapter). */
  filter: string
  top: number
  orderBy?: string
  includeCount?: boolean
}

export interface GraphDraftResult {
  id: string
  internetMessageId?: string
  conversationId?: string
}

export interface GraphMailClient {
  startInboxDelta(auth: GraphAuth, input: GraphStartDeltaInput): Promise<GraphDeltaPage>
  continueDelta(auth: GraphAuth, link: string, pageSize?: number): Promise<GraphDeltaPage>
  listInboxMessages(auth: GraphAuth, input: GraphListInboxInput): Promise<GraphListPage>
  continueList(auth: GraphAuth, nextLink: string): Promise<GraphListPage>
  getMessageMime(auth: GraphAuth, messageId: string): Promise<Buffer>
  findMessageIdByInternetMessageId(auth: GraphAuth, internetMessageId: string): Promise<string | null>
  createDraftFromMime(auth: GraphAuth, mime: Buffer): Promise<GraphDraftResult>
  sendDraft(auth: GraphAuth, messageId: string): Promise<void>
  deleteMessage(auth: GraphAuth, messageId: string): Promise<void>
  moveMessage(auth: GraphAuth, messageId: string, destinationId: string): Promise<void>
}

const GRAPH_MAX_RETRIES = 3
const GRAPH_BACKOFF_BASE_MS = 500
const GRAPH_BACKOFF_CAP_MS = 8_000
const GRAPH_DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const GRAPH_DEFAULT_PAGE_SIZE = 50
const GRAPH_MAX_PAGE_SIZE = 200
const IMMUTABLE_ID_PREFER = 'IdType="ImmutableId"'

/** Graph error codes that mean the delta token is dead and the folder must be re-synced. */
const RESYNC_ERROR_CODES = new Set(['syncstatenotfound', 'resyncrequired', 'syncstateinvalid'])

function resolveGraphRequestTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.OM_CHANNEL_MS365_REQUEST_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : GRAPH_DEFAULT_REQUEST_TIMEOUT_MS
}

/** Operator override for the delta/list page size, clamped to Graph's 1..200. */
export function resolveGraphPageSize(preferred?: number): number {
  const fromEnv = Number.parseInt(process.env.OM_CHANNEL_MS365_DELTA_PAGE_SIZE ?? '', 10)
  const candidate = preferred ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : GRAPH_DEFAULT_PAGE_SIZE)
  return Math.min(Math.max(1, Math.floor(candidate)), GRAPH_MAX_PAGE_SIZE)
}

/** Escape a string literal for an OData `$filter` (single quotes are doubled). */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export class GraphApiError extends Error {
  readonly status: number
  /** Graph `error.code` (e.g. `ErrorAccessDenied`, `syncStateNotFound`), when present. */
  readonly code: string | undefined
  readonly detail: string
  /** Parsed `Retry-After` in ms, when the server sent one. */
  readonly retryAfterMs: number | undefined
  /**
   * Read by the hub's `classifyOutboundError` (explicit hint wins over
   * heuristics): 429/5xx/timeouts retry with backoff, everything else is
   * permanent.
   */
  readonly transient: boolean

  constructor(message: string, status: number, detail: string, options: { code?: string; retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'GraphApiError'
    this.status = status
    this.code = options.code
    this.detail = detail
    this.retryAfterMs = options.retryAfterMs
    this.transient = status === 429 || status === 599 || (status >= 500 && status < 600)
  }
}

/** True when Graph says the delta token expired / became invalid (re-bootstrap needed). */
export function isResyncRequiredError(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false
  if (error.status === 410) return true
  return typeof error.code === 'string' && RESYNC_ERROR_CODES.has(error.code.toLowerCase())
}

type RequestOptions = {
  method: 'GET' | 'POST' | 'DELETE'
  body?: string
  contentType?: string
  /** Extra `Prefer` directives merged with the always-on immutable-id one. */
  prefer?: string[]
  /** `'json'` (default) parses the body; `'buffer'` returns raw bytes. */
  responseType?: 'json' | 'buffer' | 'none'
}

class FetchGraphMailClient implements GraphMailClient {
  private baseUrl(): string {
    return resolveGraphBaseUrl()
  }

  /**
   * Graph hands back absolute `@odata.nextLink` / `@odata.deltaLink` URLs. Only
   * follow them when they stay on the configured Graph origin — a persisted
   * cursor is operator-visible JSONB and must never turn the worker into an
   * open proxy.
   */
  private assertGraphLink(link: string): URL {
    let parsed: URL
    try {
      parsed = new URL(link)
    } catch {
      throw new GraphApiError('Graph link is not a valid URL', 400, 'invalid link')
    }
    const expectedOrigin = new URL(this.baseUrl()).origin
    if (parsed.origin !== expectedOrigin) {
      throw new GraphApiError(`Graph link points outside ${expectedOrigin}`, 400, 'unexpected link origin')
    }
    return parsed
  }

  async startInboxDelta(auth: GraphAuth, input: GraphStartDeltaInput): Promise<GraphDeltaPage> {
    const url = new URL(`${this.baseUrl()}/me/mailFolders/inbox/messages/delta`)
    url.searchParams.set('$select', GRAPH_MESSAGE_SELECT)
    if (input.receivedSince) {
      url.searchParams.set('$filter', `receivedDateTime ge ${input.receivedSince.toISOString()}`)
    }
    const page = await this.requestJson<GraphRawDeltaPage>(auth, url, {
      method: 'GET',
      prefer: [`odata.maxpagesize=${resolveGraphPageSize(input.pageSize)}`],
    })
    return toDeltaPage(page)
  }

  async continueDelta(auth: GraphAuth, link: string, pageSize?: number): Promise<GraphDeltaPage> {
    const url = this.assertGraphLink(link)
    const page = await this.requestJson<GraphRawDeltaPage>(auth, url, {
      method: 'GET',
      prefer: [`odata.maxpagesize=${resolveGraphPageSize(pageSize)}`],
    })
    return toDeltaPage(page)
  }

  async listInboxMessages(auth: GraphAuth, input: GraphListInboxInput): Promise<GraphListPage> {
    const url = new URL(`${this.baseUrl()}/me/mailFolders/inbox/messages`)
    url.searchParams.set('$select', GRAPH_MESSAGE_SELECT)
    url.searchParams.set('$filter', input.filter)
    url.searchParams.set('$top', String(resolveGraphPageSize(input.top)))
    if (input.orderBy) url.searchParams.set('$orderby', input.orderBy)
    if (input.includeCount) url.searchParams.set('$count', 'true')
    const page = await this.requestJson<GraphRawListPage>(auth, url, {
      method: 'GET',
      prefer: input.includeCount ? ['ConsistencyLevel=eventual'] : undefined,
    })
    return toListPage(page)
  }

  async continueList(auth: GraphAuth, nextLink: string): Promise<GraphListPage> {
    const url = this.assertGraphLink(nextLink)
    const page = await this.requestJson<GraphRawListPage>(auth, url, { method: 'GET' })
    return toListPage(page)
  }

  async getMessageMime(auth: GraphAuth, messageId: string): Promise<Buffer> {
    const url = new URL(`${this.baseUrl()}/me/messages/${encodeURIComponent(messageId)}/$value`)
    return this.requestBuffer(auth, url)
  }

  async findMessageIdByInternetMessageId(auth: GraphAuth, internetMessageId: string): Promise<string | null> {
    const url = new URL(`${this.baseUrl()}/me/messages`)
    url.searchParams.set('$filter', `internetMessageId eq '${escapeODataString(internetMessageId)}'`)
    url.searchParams.set('$select', 'id')
    url.searchParams.set('$top', '1')
    const page = await this.requestJson<GraphRawListPage>(auth, url, { method: 'GET' })
    const first = page.value?.[0]
    return typeof first?.id === 'string' && first.id.length > 0 ? first.id : null
  }

  async createDraftFromMime(auth: GraphAuth, mime: Buffer): Promise<GraphDraftResult> {
    const url = new URL(`${this.baseUrl()}/me/messages`)
    const draft = await this.requestJson<GraphDraftResult>(auth, url, {
      method: 'POST',
      contentType: 'text/plain',
      body: mime.toString('base64'),
    })
    if (!draft || typeof draft.id !== 'string' || draft.id.length === 0) {
      throw new GraphApiError('Graph did not return a draft id', 502, 'missing draft id')
    }
    return draft
  }

  async sendDraft(auth: GraphAuth, messageId: string): Promise<void> {
    const url = new URL(`${this.baseUrl()}/me/messages/${encodeURIComponent(messageId)}/send`)
    await this.requestJson<undefined>(auth, url, { method: 'POST', responseType: 'none' })
  }

  async deleteMessage(auth: GraphAuth, messageId: string): Promise<void> {
    const url = new URL(`${this.baseUrl()}/me/messages/${encodeURIComponent(messageId)}`)
    await this.requestJson<undefined>(auth, url, { method: 'DELETE', responseType: 'none' })
  }

  async moveMessage(auth: GraphAuth, messageId: string, destinationId: string): Promise<void> {
    const url = new URL(`${this.baseUrl()}/me/messages/${encodeURIComponent(messageId)}/move`)
    await this.requestJson<unknown>(auth, url, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ destinationId }),
    })
  }

  private async requestJson<T>(auth: GraphAuth, url: URL, options: RequestOptions): Promise<T> {
    const result = await this.request(auth, url, { ...options, responseType: options.responseType ?? 'json' })
    return result as T
  }

  private async requestBuffer(auth: GraphAuth, url: URL): Promise<Buffer> {
    const result = await this.request(auth, url, { method: 'GET', responseType: 'buffer' })
    return result as Buffer
  }

  /**
   * Retry transient failures (429, 5xx, timeouts) with exponential backoff +
   * jitter, honouring `Retry-After` — the mitigation Graph documents for
   * throttling (https://learn.microsoft.com/graph/throttling).
   */
  private async request(auth: GraphAuth, url: URL, options: RequestOptions): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
      Prefer: [IMMUTABLE_ID_PREFER, ...(options.prefer ?? [])].join(', '),
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = options.contentType ?? 'application/json'
    }
    let attempt = 0
    let lastError: GraphApiError | null = null
    while (attempt <= GRAPH_MAX_RETRIES) {
      let res: Response
      try {
        res = await fetchWithTimeout(url.toString(), {
          method: options.method,
          headers,
          body: options.body,
          timeoutMs: resolveGraphRequestTimeoutMs(),
        })
      } catch (err) {
        const errName = (err as { name?: unknown } | null)?.name
        const aborted = err instanceof FetchTimeoutError || errName === 'TimeoutError' || errName === 'AbortError'
        if (!aborted) throw err
        const timeoutError = new GraphApiError(
          `Microsoft Graph ${options.method} ${url.pathname} timed out`,
          599,
          'request timed out',
        )
        if (attempt === GRAPH_MAX_RETRIES) throw timeoutError
        lastError = timeoutError
        await sleep(computeBackoff(attempt))
        attempt += 1
        continue
      }

      if (res.ok) {
        if (options.responseType === 'buffer') {
          return Buffer.from(await res.arrayBuffer())
        }
        const text = await res.text()
        if (options.responseType === 'none' || !text) return undefined
        return JSON.parse(text) as unknown
      }

      const text = await res.text()
      const parsed = parseGraphError(text)
      const detail = parsed.message ?? `${res.status} ${res.statusText}`
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
      const apiError = new GraphApiError(
        `Microsoft Graph ${options.method} ${url.pathname} failed: ${detail}`,
        res.status,
        detail,
        { code: parsed.code, retryAfterMs },
      )
      if (!apiError.transient || attempt === GRAPH_MAX_RETRIES) {
        throw apiError
      }
      lastError = apiError
      await sleep(retryAfterMs ?? computeBackoff(attempt))
      attempt += 1
    }
    throw lastError ?? new GraphApiError(`Microsoft Graph ${options.method} ${url.pathname} exhausted retries`, 599, 'retries exhausted')
  }
}

type GraphRawDeltaPage = {
  value?: GraphMessageStub[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

type GraphRawListPage = {
  value?: GraphMessageStub[]
  '@odata.nextLink'?: string
  '@odata.count'?: number
}

function toDeltaPage(raw: GraphRawDeltaPage | undefined): GraphDeltaPage {
  return {
    value: Array.isArray(raw?.value) ? raw.value : [],
    nextLink: typeof raw?.['@odata.nextLink'] === 'string' ? raw['@odata.nextLink'] : undefined,
    deltaLink: typeof raw?.['@odata.deltaLink'] === 'string' ? raw['@odata.deltaLink'] : undefined,
  }
}

function toListPage(raw: GraphRawListPage | undefined): GraphListPage {
  return {
    value: Array.isArray(raw?.value) ? raw.value : [],
    nextLink: typeof raw?.['@odata.nextLink'] === 'string' ? raw['@odata.nextLink'] : undefined,
    count: typeof raw?.['@odata.count'] === 'number' ? raw['@odata.count'] : undefined,
  }
}

function parseGraphError(text: string): { code?: string; message?: string } {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } | string }
    if (parsed && typeof parsed.error === 'object' && parsed.error) {
      return {
        code: typeof parsed.error.code === 'string' ? parsed.error.code : undefined,
        message: typeof parsed.error.message === 'string' ? parsed.error.message : undefined,
      }
    }
    if (typeof parsed?.error === 'string') return { message: parsed.error }
  } catch {
    /* fall through */
  }
  return { message: text.length > 200 ? text.slice(0, 200) : text }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, GRAPH_BACKOFF_CAP_MS)
  }
  const asDate = Date.parse(value)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta > 0) return Math.min(delta, GRAPH_BACKOFF_CAP_MS)
  }
  return undefined
}

function computeBackoff(attempt: number): number {
  const raw = GRAPH_BACKOFF_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 100)
  return Math.min(raw + jitter, GRAPH_BACKOFF_CAP_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let cachedClient: GraphMailClient | null = null

export function getGraphMailClient(): GraphMailClient {
  if (!cachedClient) cachedClient = new FetchGraphMailClient()
  return cachedClient
}

/** Test-only hook to swap the default Graph client with a stub. */
export function setGraphMailClient(client: GraphMailClient | null): void {
  cachedClient = client
}
