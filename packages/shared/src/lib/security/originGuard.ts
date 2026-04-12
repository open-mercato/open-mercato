import { parseBooleanWithDefault } from '../boolean'

const UNSAFE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type SameOriginViolation = {
  reason: 'cross-site-fetch' | 'invalid-origin' | 'origin-mismatch' | 'invalid-referer' | 'referer-mismatch'
}

function readRequestOrigin(req: Request): string | null {
  try {
    return new URL(req.url).origin
  } catch {
    return null
  }
}

function readHeaderOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function isUnsafeHttpMethod(method: string): boolean {
  return UNSAFE_HTTP_METHODS.has(method.toUpperCase())
}

export function isCorsValidationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanWithDefault(env.OM_ENABLE_CORS_VALIDATION, true)
}

export function validateSameOriginMutationRequest(req: Request): SameOriginViolation | null {
  if (!isUnsafeHttpMethod(req.method)) return null

  const requestOrigin = readRequestOrigin(req)
  if (!requestOrigin) return { reason: 'invalid-origin' }

  const fetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? null
  if (fetchSite === 'cross-site') {
    return { reason: 'cross-site-fetch' }
  }

  const origin = req.headers.get('origin')
  if (origin !== null) {
    const originValue = readHeaderOrigin(origin)
    if (!originValue) return { reason: 'invalid-origin' }
    return originValue === requestOrigin ? null : { reason: 'origin-mismatch' }
  }

  const referer = req.headers.get('referer')
  if (referer !== null) {
    const refererOrigin = readHeaderOrigin(referer)
    if (!refererOrigin) return { reason: 'invalid-referer' }
    return refererOrigin === requestOrigin ? null : { reason: 'referer-mismatch' }
  }

  return null
}
