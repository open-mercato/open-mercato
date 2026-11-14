import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isEquivalentLoopbackOrigin, readConfiguredAppOrigins } from '@open-mercato/shared/lib/url'

export type SameOriginViolation = {
  reason: 'missing-origin' | 'invalid-origin' | 'cross-origin'
  requestOrigin: string | null
  expectedOrigin: string | null
}

function isSafeMethod(method: string | null | undefined) {
  const normalized = (method ?? '').toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS'
}

function readExpectedOrigins(req: Request, env: NodeJS.ProcessEnv): string[] {
  const configuredOrigins = readConfiguredAppOrigins(env)
  if (configuredOrigins.length > 0) return configuredOrigins
  try {
    return [new URL(req.url).origin]
  } catch {
    return []
  }
}

function readRequestOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')
  if (origin) return origin

  const referer = req.headers.get('referer')
  if (!referer) return null

  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

export function isCorsValidationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return parseBooleanWithDefault(env.OM_ENABLE_CORS_VALIDATION, true)
}

export function validateSameOriginMutationRequest(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): SameOriginViolation | null {
  if (!isCorsValidationEnabled(env) || isSafeMethod(req.method)) {
    return null
  }

  const expectedOrigins = readExpectedOrigins(req, env)
  const requestOrigin = readRequestOrigin(req)

  if (expectedOrigins.length === 0) {
    return null
  }

  const expectedOrigin = expectedOrigins[0]

  if (!requestOrigin) {
    return {
      reason: 'missing-origin',
      requestOrigin: null,
      expectedOrigin,
    }
  }

  try {
    const normalizedRequestOrigin = new URL(requestOrigin).origin
    const matchesExpectedOrigin = expectedOrigins.some(
      (origin) =>
        origin === normalizedRequestOrigin ||
        isEquivalentLoopbackOrigin(normalizedRequestOrigin, origin, { requireSameProtocol: true }),
    )
    if (matchesExpectedOrigin) {
      return null
    }

    return {
      reason: 'cross-origin',
      requestOrigin: normalizedRequestOrigin,
      expectedOrigin,
    }
  } catch {
    return {
      reason: 'invalid-origin',
      requestOrigin,
      expectedOrigin,
    }
  }
}
