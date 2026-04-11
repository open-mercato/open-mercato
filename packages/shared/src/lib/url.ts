const DEFAULT_DEV_APP_URL = 'http://localhost:3000'

type EnvLike = {
  APP_URL?: string
  NEXT_PUBLIC_APP_URL?: string
  APP_ALLOWED_ORIGINS?: string
  NODE_ENV?: string
}
type RequestInput = Request | string | undefined

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

function normalizeBaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function normalizeOrigin(raw: string | undefined): string | null {
  const baseUrl = normalizeBaseUrl(raw)
  if (!baseUrl) return null
  return new URL(baseUrl).origin
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

export function assertAllowedAppOrigin(input: RequestInput, env: EnvLike = process.env): void {
  const allowedOrigins = readAllowedOrigins(env)
  if (allowedOrigins.size === 0) {
    if (env.NODE_ENV === 'production') {
      throw new AppOriginConfigurationError('APP_URL must be configured in production')
    }
    return
  }

  const origins = requestOrigins(input)
  if (origins.size === 0) return

  for (const origin of origins) {
    if (!allowedOrigins.has(origin)) {
      throw new AppOriginRejectedError('Request origin is not allowed')
    }
  }
}

export function getAppBaseUrl(req: Request): string {
  const url = new URL(req.url)
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    `${url.protocol}//${url.host}`
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
