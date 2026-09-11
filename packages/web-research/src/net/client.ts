import { Agent as HttpAgent, request as sendHttp, type IncomingMessage } from 'node:http'
import { Agent as HttpsAgent, request as sendHttps } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { WebResearchError, errorMessage, isWebResearchError } from '../contract/errors'
import type { HttpClient, HttpRequestInit, HttpResponse } from '../contract/http'
import { assertPublicUrl, type LookupFn } from './ssrf'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; OpenMercatoResearch/1.0; +https://github.com/open-mercato/open-mercato)'
const DEFAULT_MAX_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const MAX_RETRIES = 2
const MAX_BACKOFF_MS = 5_000
/**
 * Hard ceiling on a single `sleep()`. Backoff is already clamped to
 * `MAX_BACKOFF_MS`, but the politeness delay is derived from configuration and
 * a `Retry-After` header is remote input, so the timer itself is capped too —
 * no caller can park a request for an unbounded stretch.
 */
const MAX_SLEEP_MS = 60_000
/**
 * Ceiling on one `request()` call, redirects and retries included.
 *
 * `timeoutMs` bounds a single attempt, so without this a call could legitimately
 * run for redirects x retries x timeout plus backoff — minutes, inside an adapter
 * budget of seconds. The adapter's signal would eventually cut it, but only after
 * the work was already spent.
 */
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000

export type HttpClientOptions = {
  readonly userAgent?: string
  readonly acceptLanguage?: string
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly maxRetries?: number
  /** Ceiling on one call including every redirect hop and retry. */
  readonly maxTotalMs?: number
  /** Minimum gap between requests to the same host. */
  readonly politenessMs?: number
  readonly lookup?: LookupFn
  /**
   * Hosts allowed to resolve to a non-public address. Empty by default; see
   * `assertPublicUrl` for why this is an allowlist and not a boolean.
   */
  readonly allowPrivateHosts?: readonly string[]
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now?: () => number
}

/**
 * Resolves a hostname to exactly the addresses the SSRF guard already vetted.
 * Without this the kernel re-resolves at connect time, reopening the rebinding
 * window between check and connect. Only name resolution is overridden, so SNI
 * and certificate validation still see the real hostname.
 */
export function createPinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: isIP(address) }))
  return (hostname, options, callback) => {
    if (entries.length === 0) {
      callback(new Error(`No pinned address for ${hostname}`), '', 0)
      return
    }
    const requestedFamily = typeof options === 'number' ? options : (options?.family ?? 0)
    const matching = requestedFamily
      ? entries.filter((entry) => entry.family === requestedFamily)
      : entries
    const selected = matching.length > 0 ? matching : entries
    if (typeof options === 'object' && options?.all) {
      callback(null, selected)
      return
    }
    callback(null, selected[0].address, selected[0].family)
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  // Explicit finite check + relational clamp rather than `Math.min`: a NaN
  // duration must not reach `setTimeout`, and the upper bound has to be
  // provable at the call site.
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  const bounded = ms > MAX_SLEEP_MS ? MAX_SLEEP_MS : ms
  return new Promise((resolve) => {
    const timer = setTimeout(finish, bounded)
    function finish(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

function decompress(response: IncomingMessage): Readable {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip())
  if (encoding === 'deflate') return response.pipe(createInflate())
  if (encoding === 'br') return response.pipe(createBrotliDecompress())
  return response
}

/**
 * Reads at most `maxBytes`, decoding incrementally so a cap landing inside a
 * multi-byte sequence does not produce a replacement character at the tail.
 */
async function readCapped(
  stream: Readable,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let bytes = 0
  let truncated = false
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      if (bytes >= maxBytes) {
        truncated = true
        break
      }
      const remaining = maxBytes - bytes
      if (buffer.byteLength > remaining) {
        text += decoder.decode(buffer.subarray(0, remaining), { stream: true })
        bytes = maxBytes
        truncated = true
        break
      }
      text += decoder.decode(buffer, { stream: true })
      bytes += buffer.byteLength
    }
  } finally {
    stream.destroy()
  }
  text += decoder.decode()
  return { text, truncated, bytes }
}

type SentRequest = {
  readonly response: IncomingMessage
  readonly dispose: () => void
  /**
   * Why we tore the exchange down, if we did.
   *
   * Destroying a request does not deliver our reason to the response stream —
   * Node surfaces its own socket error there — so a read cut short by our own
   * timeout or abort would otherwise be reported as a generic network fault,
   * and an adapter would call a deadline breach a retriable error.
   */
  readonly terminalError: () => WebResearchError | null
}

type SendOptions = {
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

function send(target: URL, addresses: readonly string[], options: SendOptions): Promise<SentRequest> {
  return new Promise((resolve, reject) => {
    const secure = target.protocol === 'https:'
    const agent = secure
      ? new HttpsAgent({ keepAlive: false, lookup: createPinnedLookup(addresses) })
      : new HttpAgent({ keepAlive: false, lookup: createPinnedLookup(addresses) })
    const transport = secure ? sendHttps : sendHttp
    const request = transport(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method,
        headers: options.headers,
        agent,
      },
      (response) => {
        clearTimeout(headerTimer)
        resolve({ response, dispose, terminalError: () => terminal })
      },
    )

    let terminal: WebResearchError | null = null
    const fail = (error: WebResearchError): void => {
      terminal = error
      request.destroy(error)
    }

    /**
     * Teardown for the whole exchange, headers *and* body. The abort listener and
     * the socket idle timer deliberately stay armed past the response callback:
     * releasing them there leaves a body read that no signal and no deadline can
     * interrupt, so a server that trickles bytes forever pins a socket and an
     * adapter promise for the life of the process.
     */
    const dispose = (): void => {
      clearTimeout(headerTimer)
      request.setTimeout(0)
      options.signal?.removeEventListener('abort', onAbort)
      request.destroy()
      agent.destroy()
    }

    const headerTimer = setTimeout(() => {
      fail(new WebResearchError('timeout', `Request to ${target.href} timed out`))
    }, options.timeoutMs)

    request.setTimeout(options.timeoutMs, () => {
      fail(new WebResearchError('timeout', `Request to ${target.href} stalled`))
    })

    function onAbort(): void {
      fail(new WebResearchError('aborted', `Request to ${target.href} was aborted`))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    request.on('error', (error) => {
      dispose()
      reject(
        terminal ??
          (isWebResearchError(error)
            ? error
            : new WebResearchError('network', `Request to ${target.href} failed: ${errorMessage(error)}`, {
                cause: error,
              })),
      )
    })

    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}

function headerMap(response: IncomingMessage): Map<string, string> {
  const headers = new Map<string, string>()
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    headers.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

function retryAfterMs(headers: Map<string, string>): number | undefined {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number.parseInt(raw.trim(), 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

function contentTypeOf(headers: Map<string, string>): string | null {
  const raw = headers.get('content-type')
  if (!raw) return null
  return raw.split(';')[0].trim().toLowerCase()
}

function isAcceptable(contentType: string | null, accept: readonly string[] | undefined): boolean {
  if (!accept || accept.length === 0) return true
  if (contentType === null) return true
  return accept.some((prefix) => contentType.startsWith(prefix))
}

function statusError(status: number, url: string, headers: Map<string, string>): WebResearchError {
  if (status === 429) {
    return new WebResearchError('blocked', `Rate limited by ${url} (HTTP 429)`, {
      status,
      retryAfterMs: retryAfterMs(headers),
    })
  }
  if (status === 403 || status === 401) {
    return new WebResearchError('blocked', `Access denied by ${url} (HTTP ${status})`, { status })
  }
  return new WebResearchError('bad_response', `Request to ${url} failed with HTTP ${status}`, { status })
}

function isRetriable(error: WebResearchError): boolean {
  if (error.code === 'blocked') return error.status === 429
  if (error.code === 'network') return true
  return error.code === 'bad_response' && (error.status ?? 0) >= 500
}

/**
 * The single hardened egress path: SSRF-vetted, DNS-pinned per redirect hop,
 * manually redirected so every hop is re-vetted, byte-capped, content-type
 * gated, and polite to each host.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const acceptLanguage = options.acceptLanguage ?? 'en-US,en;q=0.9'
  const defaultMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  const maxTotalMs = options.maxTotalMs ?? DEFAULT_TOTAL_TIMEOUT_MS
  const politenessMs = options.politenessMs ?? 0
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const nextAllowedAt = new Map<string, number>()

  async function waitForHost(host: string, signal?: AbortSignal): Promise<void> {
    if (politenessMs <= 0) return
    const earliest = nextAllowedAt.get(host) ?? 0
    const current = now()
    const delay = earliest - current
    nextAllowedAt.set(host, Math.max(current, earliest) + politenessMs)
    if (delay > 0) await sleep(delay, signal)
  }

  async function attempt(
    target: URL,
    addresses: readonly string[],
    init: HttpRequestInit,
    carryCallerHeaders: boolean,
  ) {
    const headers: Record<string, string> = {
      'user-agent': userAgent,
      'accept-language': acceptLanguage,
      'accept-encoding': 'gzip, deflate, br',
      accept: init.accept?.length ? `${init.accept.join(', ')}, */*;q=0.1` : '*/*',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(carryCallerHeaders ? (init.headers ?? {}) : {}),
    }
    return send(target, addresses, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      timeoutMs: init.timeoutMs ?? defaultTimeoutMs,
      ...(init.signal ? { signal: init.signal } : {}),
    })
  }

  async function request(rawUrl: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    const maxBytes = init.maxBytes ?? defaultMaxBytes
    const expiresAt = now() + maxTotalMs
    const outOfTime = (): boolean => now() >= expiresAt
    let currentUrl = rawUrl
    // Caller headers carry vendor credentials (`authorization`, an API-key header).
    // A redirect to another origin must not replay them, or a compromised or
    // merely sloppy endpoint can harvest a tenant's key with a single 302.
    let sameOrigin = true

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (outOfTime()) {
        throw new WebResearchError('timeout', `Request to ${rawUrl} exceeded its ${maxTotalMs}ms budget`)
      }
      const vetted = await assertPublicUrl(currentUrl, 'web research fetch', {
        ...(options.lookup ? { lookup: options.lookup } : {}),
        ...(options.allowPrivateHosts ? { allowPrivateHosts: options.allowPrivateHosts } : {}),
      })
      await waitForHost(vetted.url.host, init.signal)

      let sent: SentRequest | null = null
      let lastError: WebResearchError | null = null
      for (let retry = 0; retry <= maxRetries; retry += 1) {
        try {
          sent = await attempt(vetted.url, vetted.addresses, init, sameOrigin)
          const status = sent.response.statusCode ?? 0
          if (status >= 400) {
            const error = statusError(status, vetted.url.href, headerMap(sent.response))
            sent.response.resume()
            sent.dispose()
            sent = null
            throw error
          }
          break
        } catch (error) {
          // Branded rather than `instanceof`: this package typechecks as `src`
          // and runs as `dist`, so the two class identities can differ.
          const typed = isWebResearchError(error)
            ? error
            : new WebResearchError('network', errorMessage(error), { cause: error })
          lastError = typed
          if (typed.code === 'aborted' || retry === maxRetries || !isRetriable(typed)) throw typed
          // Retrying past the budget only delays the failure the caller already earned.
          if (outOfTime()) throw typed
          const backoff = Math.min(typed.retryAfterMs ?? 250 * 2 ** retry, MAX_BACKOFF_MS)
          await sleep(backoff, init.signal)
        }
      }
      if (!sent) throw lastError ?? new WebResearchError('network', `Request to ${currentUrl} failed`)

      const headers = headerMap(sent.response)
      const status = sent.response.statusCode ?? 0

      if (status >= 300 && status < 400) {
        const location = headers.get('location')
        sent.response.resume()
        sent.dispose()
        if (!location) {
          throw new WebResearchError('bad_response', `Redirect from ${currentUrl} without a Location header`)
        }
        const next = new URL(location, vetted.url)
        if (next.origin !== vetted.url.origin) sameOrigin = false
        currentUrl = next.toString()
        continue
      }

      const contentType = contentTypeOf(headers)
      if (!isAcceptable(contentType, init.accept)) {
        sent.response.resume()
        sent.dispose()
        throw new WebResearchError(
          'unsupported_content_type',
          `Refusing to decode ${contentType ?? 'unknown'} from ${vetted.url.href} as text`,
        )
      }

      try {
        const { text, truncated } = await readCapped(decompress(sent.response), maxBytes)
        return { url: vetted.url.href, status, headers, contentType, body: text, truncated }
      } catch (error) {
        const terminal = sent.terminalError()
        if (terminal) throw terminal
        throw isWebResearchError(error)
          ? error
          : new WebResearchError('network', `Reading ${vetted.url.href} failed: ${errorMessage(error)}`, {
              cause: error,
            })
      } finally {
        sent.dispose()
      }
    }

    throw new WebResearchError('too_many_redirects', `Exceeded ${maxRedirects} redirects from ${rawUrl}`)
  }

  return { request }
}
