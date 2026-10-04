import type { RouteMatchParams } from '../../modules/registry'

const matchedApiRoutePaths = new WeakMap<Request, string>()

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

export function bindMatchedApiRoutePath(
  request: Request,
  pattern: string,
  params: RouteMatchParams,
): boolean {
  if (!hasValidPathEncoding(request)) return false
  const canonicalPath = buildCanonicalMatchedPath(pattern, params)
  if (canonicalPath === null) return false
  matchedApiRoutePaths.set(request, canonicalPath)
  return true
}

export function getMatchedApiRoutePath(request: Request): string | undefined {
  return matchedApiRoutePaths.get(request)
}

function toInterceptorRoutePath(pathname: string): string {
  if (pathname.startsWith('/api/')) return pathname.slice(5)
  if (pathname === '/api') return ''
  return pathname.replace(/^\/+/, '')
}

export function resolveApiInterceptorRoutePath(request: Request): string | null {
  const matchedPath = getMatchedApiRoutePath(request)
  if (matchedPath !== undefined) return toInterceptorRoutePath(matchedPath)

  try {
    const pathname = new URL(request.url).pathname
    for (const segment of pathname.split('/')) decodeURIComponent(segment)
    return toInterceptorRoutePath(pathname)
  } catch {
    return null
  }
}
