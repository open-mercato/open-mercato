import type { RouteMatchParams } from '../../modules/registry'

const matchedApiRoutePaths = new WeakMap<Request, string>()
const ROUTE_IDENTITY_HEADER = 'x-open-mercato-route-identity'
const MAX_ROUTE_IDENTITY_TOKENS = 4096
const matchedApiRouteTokens = new Map<string, string>()

function normalizePath(path: string): string {
  return (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '') || '/'
}

function hasValidPathEncoding(request: Request): boolean {
  try {
    const pathname = new URL(request.url).pathname
    for (const segment of pathname.split('/')) decodeURIComponent(segment)
    return true
  } catch {
    return false
  }
}

function buildCanonicalMatchedPath(pattern: string, params: RouteMatchParams): string | null {
  const segments = normalizePath(pattern).split('/').slice(1)
  const canonicalSegments: string[] = []

  for (const segment of segments) {
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/)
    const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/)
    const dynamic = segment.match(/^\[(.+)\]$/)
    const paramName = catchAll?.[1] ?? optionalCatchAll?.[1] ?? dynamic?.[1]

    if (!paramName) {
      canonicalSegments.push(segment)
      continue
    }

    const value = params[paramName]
    if (Array.isArray(value)) {
      canonicalSegments.push(...value)
      continue
    }
    if (typeof value === 'string') {
      canonicalSegments.push(value)
      continue
    }
    if (optionalCatchAll) continue
    return null
  }

  return `/${canonicalSegments.join('/')}`
}

function createRouteIdentityToken(): string | null {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) return null
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = cryptoApi.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function rememberRouteIdentity(token: string, canonicalPath: string): void {
  matchedApiRouteTokens.set(token, canonicalPath)
  while (matchedApiRouteTokens.size > MAX_ROUTE_IDENTITY_TOKENS) {
    const oldestToken = matchedApiRouteTokens.keys().next().value
    if (typeof oldestToken !== 'string') return
    matchedApiRouteTokens.delete(oldestToken)
  }
}

export function bindMatchedApiRoutePath(
  request: Request,
  pattern: string,
  params: RouteMatchParams,
): boolean {
  if (!hasValidPathEncoding(request)) return false
  const canonicalPath = buildCanonicalMatchedPath(pattern, params)
  if (canonicalPath === null) return false
  const token = createRouteIdentityToken()
  if (token === null) return false
  try {
    request.headers.set(ROUTE_IDENTITY_HEADER, token)
  } catch {
    return false
  }
  rememberRouteIdentity(token, canonicalPath)
  matchedApiRoutePaths.set(request, canonicalPath)
  return true
}

export function getMatchedApiRoutePath(request: Request): string | undefined {
  const directPath = matchedApiRoutePaths.get(request)
  if (directPath !== undefined) return directPath
  const token = request.headers.get(ROUTE_IDENTITY_HEADER)
  if (!token) return undefined
  return matchedApiRouteTokens.get(token)
}

function toInterceptorRoutePath(pathname: string): string {
  if (pathname.startsWith('/api/')) return pathname.slice(5)
  if (pathname === '/api') return ''
  return pathname.replace(/^\/+/, '')
}

export function resolveApiInterceptorRoutePath(request: Request): string | null {
  const matchedPath = getMatchedApiRoutePath(request)
  if (matchedPath !== undefined) return toInterceptorRoutePath(matchedPath)
  if (request.headers.has(ROUTE_IDENTITY_HEADER)) return null

  try {
    const pathname = new URL(request.url).pathname
    for (const segment of pathname.split('/')) decodeURIComponent(segment)
    return toInterceptorRoutePath(pathname)
  } catch {
    return null
  }
}
