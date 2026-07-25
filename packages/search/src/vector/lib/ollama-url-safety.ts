import {
  assertStaticallySafeOutboundUrl,
  safeOutboundFetch,
  type HostLookup,
  type SafeOutboundFetchOptions,
  type UrlSafetyReason,
} from '@open-mercato/shared/lib/url-safety'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const SUBJECT = 'Ollama base URL'
const MAX_OLLAMA_REDIRECTS = 5

export class UnsafeOllamaBaseUrlError extends Error {
  public readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? `Ollama base URL rejected: ${reason}`)
    this.name = 'UnsafeOllamaBaseUrlError'
    this.reason = reason
  }
}

const ollamaErrorFactory = (reason: UrlSafetyReason, message: string) =>
  new UnsafeOllamaBaseUrlError(reason, message)

export function getOllamaBaseUrlAllowlist(): ReadonlySet<string> {
  const raw = process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST ?? ''
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  )
}

export function isAllowPrivateOllamaBaseUrlEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE, false)
}

export function assertSafeOllamaBaseUrl(rawUrl: string): void {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new UnsafeOllamaBaseUrlError('missing_host', `${SUBJECT} is required`)
  }

  assertStaticallySafeOutboundUrl(rawUrl, {
    errorFactory: ollamaErrorFactory,
    subject: SUBJECT,
    allowPrivate: shouldAllowPrivateOllamaUrl(rawUrl),
  })
}

export type SafeOllamaFetchDeps = {
  lookupHost?: HostLookup
  fetchImpl?: SafeOutboundFetchOptions['fetchImpl']
  maxRedirects?: number
}

export async function safeOllamaFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  deps: SafeOllamaFetchDeps = {},
): Promise<Response> {
  const request = new Request(input, init)
  const maxRedirects = deps.maxRedirects ?? MAX_OLLAMA_REDIRECTS
  let currentUrl = request.url
  let currentMethod = request.method
  let currentHeaders = new Headers(request.headers)
  let currentBody =
    currentMethod === 'GET' || currentMethod === 'HEAD'
      ? undefined
      : await request.clone().arrayBuffer()

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await safeOutboundFetch(
      currentUrl,
      {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: request.signal,
        redirect: 'manual',
      },
      {
        errorFactory: ollamaErrorFactory,
        subject: SUBJECT,
        allowPrivate: shouldAllowPrivateOllamaUrl(currentUrl),
        lookupHost: deps.lookupHost,
        fetchImpl: deps.fetchImpl,
      },
    )

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response
    }
    const location = response.headers.get('location')
    if (!location) return response
    if (redirectCount === maxRedirects) {
      throw new UnsafeOllamaBaseUrlError(
        'too_many_redirects',
        `${SUBJECT} exceeded ${maxRedirects} redirects`,
      )
    }

    const nextUrl = new URL(location, currentUrl)
    if (nextUrl.origin !== new URL(currentUrl).origin) {
      currentHeaders = new Headers(currentHeaders)
      currentHeaders.delete('authorization')
      currentHeaders.delete('cookie')
      currentHeaders.delete('proxy-authorization')
    }
    if (
      (response.status === 303 && currentMethod !== 'GET' && currentMethod !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
    ) {
      currentMethod = 'GET'
      currentBody = undefined
      currentHeaders.delete('content-length')
      currentHeaders.delete('content-type')
    }
    await response.body?.cancel()
    currentUrl = nextUrl.toString()
  }

  throw new UnsafeOllamaBaseUrlError('too_many_redirects')
}

function shouldAllowPrivateOllamaUrl(rawUrl: string): boolean {
  return (
    allowlistMatches(rawUrl, getOllamaBaseUrlAllowlist()) ||
    isAllowPrivateOllamaBaseUrlEnabled() ||
    (process.env.NODE_ENV !== 'production' && isLoopbackOnlyUrl(rawUrl))
  )
}

function allowlistMatches(rawUrl: string, allowlist: ReadonlySet<string>): boolean {
  if (allowlist.size === 0) return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  const hostPort = `${host}:${port}`
  return allowlist.has(host) || allowlist.has(hostPort)
}

function isLoopbackOnlyUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  if (host === 'localhost') return true
  if (host === '::1') return true
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true
  return false
}
