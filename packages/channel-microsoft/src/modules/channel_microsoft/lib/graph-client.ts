import { MICROSOFT_GRAPH_BASE } from './oauth'

/**
 * Thin Microsoft Graph mail wrapper. Only the endpoints the adapter uses are
 * exposed, similar to channel-gmail/lib/gmail-client.ts:
 *
 *   - inboxDelta      → GET /me/mailFolders/inbox/messages/delta (first call)
 *                     or follow-up via the deltaLink stored on channel state
 *   - getMessageMime  → GET /me/messages/{id}/$value  (returns full RFC2822 MIME)
 *   - sendMail        → POST /me/sendMail  (Graph "Message" + saveToSentItems)
 *   - getProfile      → GET /me  (used for health + initial identifier)
 *   - deleteMessage   → DELETE /me/messages/{id}  (Graph DELETE moves to Deleted Items)
 */

export interface GraphAuth {
  accessToken: string
}

export interface GraphDeltaResponse {
  value: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

export interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  internetMessageId?: string
  receivedDateTime?: string
  isRead?: boolean
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  bccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  body?: { contentType?: 'text' | 'html'; content?: string }
  bodyPreview?: string
  hasAttachments?: boolean
  inferenceClassification?: 'focused' | 'other'
  categories?: string[]
}

export interface GraphSendMailInput {
  message: {
    subject?: string
    body: { contentType: 'Text' | 'HTML'; content: string }
    toRecipients: Array<{ emailAddress: { address: string; name?: string } }>
    ccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>
    bccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>
    internetMessageHeaders?: Array<{ name: string; value: string }>
  }
  saveToSentItems?: boolean
}

export interface GraphProfile {
  id: string
  displayName?: string
  mail?: string
  userPrincipalName?: string
}

export interface GraphApiClient {
  inboxDelta(auth: GraphAuth, link?: string): Promise<GraphDeltaResponse>
  getMessageMime(auth: GraphAuth, messageId: string): Promise<Buffer>
  sendMail(auth: GraphAuth, input: GraphSendMailInput): Promise<void>
  getProfile(auth: GraphAuth): Promise<GraphProfile>
  deleteMessage(auth: GraphAuth, messageId: string): Promise<void>
}

export class GraphApiError extends Error {
  readonly status: number
  readonly detail: string
  constructor(message: string, status: number, detail: string) {
    super(message)
    this.name = 'GraphApiError'
    this.status = status
    this.detail = detail
  }
}

const GRAPH_MAX_RETRIES = 3
const GRAPH_BACKOFF_BASE_MS = 500
const GRAPH_BACKOFF_CAP_MS = 10_000

class FetchGraphApiClient implements GraphApiClient {
  async inboxDelta(auth: GraphAuth, link?: string): Promise<GraphDeltaResponse> {
    const url = link ?? `${MICROSOFT_GRAPH_BASE}/me/mailFolders/inbox/messages/delta`
    return this.requestJson<GraphDeltaResponse>(auth, url, 'GET')
  }

  async getMessageMime(auth: GraphAuth, messageId: string): Promise<Buffer> {
    const url = `${MICROSOFT_GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/$value`
    let attempt = 0
    let lastError: GraphApiError | null = null
    while (attempt <= GRAPH_MAX_RETRIES) {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }
      const text = await res.text()
      const apiError = new GraphApiError(
        `Graph GET /me/messages/{id}/$value failed: ${res.status} ${res.statusText}`,
        res.status,
        parseError(text) ?? text,
      )
      const transient = res.status === 429 || (res.status >= 500 && res.status < 600)
      if (!transient || attempt === GRAPH_MAX_RETRIES) throw apiError
      lastError = apiError
      const waitMs = parseRetryAfter(res.headers.get('retry-after')) ?? computeBackoff(attempt)
      await sleep(waitMs)
      attempt += 1
    }
    throw lastError ?? new GraphApiError('Graph GET /me/messages/{id}/$value exhausted retries', 599, 'retries exhausted')
  }

  async sendMail(auth: GraphAuth, input: GraphSendMailInput): Promise<void> {
    const url = `${MICROSOFT_GRAPH_BASE}/me/sendMail`
    await this.requestJson<void>(auth, url, 'POST', input)
  }

  async getProfile(auth: GraphAuth): Promise<GraphProfile> {
    const url = `${MICROSOFT_GRAPH_BASE}/me`
    return this.requestJson<GraphProfile>(auth, url, 'GET')
  }

  async deleteMessage(auth: GraphAuth, messageId: string): Promise<void> {
    const url = `${MICROSOFT_GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`
    await this.requestJson<void>(auth, url, 'DELETE')
  }

  private async requestJson<T>(auth: GraphAuth, url: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}` }
    let payload: BodyInit | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    // Microsoft Graph documents `Retry-After` for 429 and 503 in
    // https://learn.microsoft.com/en-us/graph/throttling — we honour the
    // header verbatim (capped) and fall back to capped exponential backoff
    // otherwise.
    let attempt = 0
    let lastError: GraphApiError | null = null
    while (attempt <= GRAPH_MAX_RETRIES) {
      const res = await fetch(url, { method, headers, body: payload })
      const text = await res.text()
      if (res.ok) {
        if (!text) return undefined as unknown as T
        return JSON.parse(text) as T
      }
      const apiError = new GraphApiError(
        `Graph ${method} ${new URL(url).pathname} failed: ${res.status} ${res.statusText}`,
        res.status,
        parseError(text) ?? text,
      )
      const transient = res.status === 429 || (res.status >= 500 && res.status < 600)
      if (!transient || attempt === GRAPH_MAX_RETRIES) throw apiError
      lastError = apiError
      const waitMs = parseRetryAfter(res.headers.get('retry-after')) ?? computeBackoff(attempt)
      await sleep(waitMs)
      attempt += 1
    }
    throw lastError ?? new GraphApiError(`Graph ${method} exhausted retries`, 599, 'retries exhausted')
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, GRAPH_BACKOFF_CAP_MS)
  }
  const asDate = Date.parse(value)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta > 0) return Math.min(delta, GRAPH_BACKOFF_CAP_MS)
  }
  return null
}

function computeBackoff(attempt: number): number {
  const raw = GRAPH_BACKOFF_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 100)
  return Math.min(raw + jitter, GRAPH_BACKOFF_CAP_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseError(text: string): string | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } | string }
    if (parsed && typeof parsed.error === 'object' && parsed.error) {
      return parsed.error.message ?? parsed.error.code ?? null
    }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    /* ignore */
  }
  return text.length > 200 ? text.slice(0, 200) : text
}

let cachedClient: GraphApiClient | null = null

export function getGraphApiClient(): GraphApiClient {
  if (!cachedClient) cachedClient = new FetchGraphApiClient()
  return cachedClient
}

export function setGraphApiClient(client: GraphApiClient | null): void {
  cachedClient = client
}
