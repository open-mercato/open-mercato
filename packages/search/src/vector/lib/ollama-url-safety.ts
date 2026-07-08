import {
  assertStaticallySafeOutboundUrl,
  type UrlSafetyReason,
} from '@open-mercato/shared/lib/url-safety'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const SUBJECT = 'Ollama base URL'

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

  const allowPrivate =
    allowlistMatches(rawUrl, getOllamaBaseUrlAllowlist()) ||
    isAllowPrivateOllamaBaseUrlEnabled() ||
    (process.env.NODE_ENV !== 'production' && isLoopbackOnlyUrl(rawUrl))

  assertStaticallySafeOutboundUrl(rawUrl, {
    errorFactory: ollamaErrorFactory,
    subject: SUBJECT,
    allowPrivate,
  })
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
