const DEFAULT_DEV_APP_URL = 'http://localhost:3000'

type EnvLike = Record<string, string | undefined> & {
  APP_URL?: string
  NEXT_PUBLIC_APP_URL?: string
  APP_ALLOWED_ORIGINS?: string
  NODE_ENV?: string
}
type RequestInput = Request | string | undefined

export type SecurityEmailUrlErrorMapping = {
  scope: string
  configMessage: string
}

export class AppOriginConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppOriginConfigurationError'
  }
}

export class AppOriginRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppOriginRejectedError'
  }
}

function parseBaseUrl(raw: string | undefined): URL | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url
  } catch {
    return null
  }
}

function normalizeBaseUrl(raw: string | undefined): string | null {
  const url = parseBaseUrl(raw)
  return url ? url.toString().replace(/\/$/, '') : null
}

function normalizeOrigin(raw: string | undefined): string | null {
  const url = parseBaseUrl(raw)
  return url ? url.origin : null
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function readAllowedOrigins(env: EnvLike): Set<string> {
  const origins = new Set<string>()
  for (const raw of [env.APP_URL, env.NEXT_PUBLIC_APP_URL, ...readCsv(env.APP_ALLOWED_ORIGINS)]) {
    const origin = normalizeOrigin(raw)
    if (origin) origins.add(origin)
  }
  return origins
}

function readFirstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

function originFromHost(protocol: string, rawHost: string | null): string | null {
  const host = readFirstHeaderValue(rawHost)
  if (!host) return null
  return normalizeOrigin(`${protocol}//${host}`)
}

function requestOrigins(input: RequestInput): Set<string> {
  const origins = new Set<string>()
  if (!input) return origins

  const requestUrl = typeof input === 'string' ? input : input.url
  let parsedUrl: URL
  try {
    parsedUrl = new URL(requestUrl)
  } catch {
    return origins
  }

  const urlOrigin = normalizeOrigin(parsedUrl.origin)
  if (urlOrigin) origins.add(urlOrigin)

  if (typeof input === 'string') return origins

  const forwardedProto = readFirstHeaderValue(input.headers.get('x-forwarded-proto')) ?? parsedUrl.protocol.replace(/:$/, '')
  const protocol = forwardedProto.endsWith(':') ? forwardedProto : `${forwardedProto}:`
  const hostOrigin = originFromHost(protocol, input.headers.get('host'))
  const forwardedHostOrigin = originFromHost(protocol, input.headers.get('x-forwarded-host'))
  if (hostOrigin) origins.add(hostOrigin)
  if (forwardedHostOrigin) origins.add(forwardedHostOrigin)
  return origins
}

function logOriginDebugContext(input: RequestInput, allowedOrigins: Set<string>, rejectedOrigin?: string): void {
  if (typeof input === 'string') {
    console.error('[origin-check] rejected string input', {
      requestUrl: input,
      rejectedOrigin: rejectedOrigin ?? null,
      allowedOrigins: Array.from(allowedOrigins),
    })
    return
  }

  if (!input) {
    console.error('[origin-check] rejected empty input', {
      rejectedOrigin: rejectedOrigin ?? null,
      allowedOrigins: Array.from(allowedOrigins),
    })
    return
  }

  console.error('[origin-check] rejected request', {
    requestUrl: input.url,
    host: input.headers.get('host'),
    forwardedHost: input.headers.get('x-forwarded-host'),
    forwardedProto: input.headers.get('x-forwarded-proto'),
    derivedOrigins: Array.from(requestOrigins(input)),
    rejectedOrigin: rejectedOrigin ?? null,
    allowedOrigins: Array.from(allowedOrigins),
  })
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname)
  } catch {
    return false
  }
}

function normalizeOriginPort(url: URL): string {
  if (url.port) return url.port
  if (url.protocol === 'https:') return '443'
  if (url.protocol === 'http:') return '80'
  return ''
}

function isEquivalentLoopbackOrigin(origin: string, allowedOrigin: string): boolean {
  try {
    const candidateUrl = new URL(origin)
    const allowedUrl = new URL(allowedOrigin)
    if (!isLoopbackHostname(candidateUrl.hostname) || !isLoopbackHostname(allowedUrl.hostname)) {
      return false
    }
    return normalizeOriginPort(candidateUrl) === normalizeOriginPort(allowedUrl)
  } catch {
    return false
  }
}

function shouldAllowLoopbackOrigin(origin: string, allowedOrigins: Set<string>, env: EnvLike): boolean {
  if (!isLoopbackOrigin(origin)) return false
  for (const allowedOrigin of allowedOrigins) {
    if (!isLoopbackOrigin(allowedOrigin)) continue
    if (env.NODE_ENV !== 'production') return true
    if (isEquivalentLoopbackOrigin(origin, allowedOrigin)) return true
  }
  return false
}

export function assertAllowedAppOrigin(input: RequestInput, env: EnvLike = process.env): void {
  const allowedOrigins = readAllowedOrigins(env)
  if (allowedOrigins.size === 0) {
    if (env.NODE_ENV === 'production') {
      logOriginDebugContext(input, allowedOrigins)
      throw new AppOriginConfigurationError('APP_URL must be configured in production')
    }
    return
  }
  const origins = requestOrigins(input)
  if (origins.size === 0) return

  for (const origin of origins) {
    if (!allowedOrigins.has(origin)) {
      if (shouldAllowLoopbackOrigin(origin, allowedOrigins, env)) continue
      logOriginDebugContext(input, allowedOrigins, origin)
      throw new AppOriginRejectedError('Request origin is not allowed')
    }
  }
}

export function resolveRequestOrigin(req: Request): string {
  const url = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
  return `${proto}://${host}`
}

export function getAppBaseUrl(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    resolveRequestOrigin(req)
  )
}

export function toAbsoluteUrl(req: Request, path: string): string {
  return new URL(path, getAppBaseUrl(req)).toString()
}

export function getSecurityEmailBaseUrl(input?: RequestInput, env: EnvLike = process.env): string {
  const configuredAppUrl = normalizeBaseUrl(env.APP_URL)
  if (!configuredAppUrl) {
    if (env.NODE_ENV === 'production') {
      throw new AppOriginConfigurationError('APP_URL must be configured in production')
    }
    return DEFAULT_DEV_APP_URL
  }

  assertAllowedAppOrigin(input, env)
  return configuredAppUrl
}

export function toSecurityEmailUrl(input: RequestInput, path: string, env: EnvLike = process.env): string {
  const base = getSecurityEmailBaseUrl(input, env)
  return `${base}/${path.replace(/^\/+/, '')}`
}

export function mapSecurityEmailUrlError(
  error: unknown,
  mapping: SecurityEmailUrlErrorMapping,
): { status: number; body: { error: string } } | null {
  if (error instanceof AppOriginRejectedError) {
    return { status: 400, body: { error: 'Invalid request origin' } }
  }
  if (error instanceof AppOriginConfigurationError) {
    console.error(`[${mapping.scope}] APP_URL is required in production`)
    return { status: 500, body: { error: mapping.configMessage } }
  }
  return null
}
