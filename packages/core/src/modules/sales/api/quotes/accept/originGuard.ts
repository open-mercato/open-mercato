import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isEquivalentLoopbackOrigin } from '@open-mercato/shared/lib/url'

export type SameOriginViolation = {
  reason: 'missing-origin' | 'invalid-origin' | 'cross-origin'
  requestOrigin: string | null
  expectedOrigin: string | null
}

function isSafeMethod(method: string | null | undefined) {
  const normalized = (method ?? '').toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS'
}

function readExpectedOrigin(req: Request): string | null {
  try {
    // Behind a TLS-terminating proxy, `req.url` carries the app's listening
    // identity (e.g. https://localhost:3000), not its public origin. Prefer the
    // configured app origin — a trusted, operator-set value, never derived from
    // this request.
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
    if (configuredAppUrl) {
      return new URL(configuredAppUrl).origin
    }
    // No configured app origin: fall back to the request's own URL only. Do NOT
    // use getAppBaseUrl()'s request-derived fallback here — it trusts
    // X-Forwarded-Proto/X-Forwarded-Host, which are attacker-controlled on an
    // unauthenticated public endpoint. A forged Origin plus matching forwarded
    // headers would otherwise make both sides of this comparison agree.
    return new URL(req.url).origin
  } catch {
    return null
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

  const expectedOrigin = readExpectedOrigin(req)
  const requestOrigin = readRequestOrigin(req)

  if (!expectedOrigin) {
    return null
  }

  if (!requestOrigin) {
    return {
      reason: 'missing-origin',
      requestOrigin: null,
      expectedOrigin,
    }
  }

  try {
    const normalizedRequestOrigin = new URL(requestOrigin).origin
    if (normalizedRequestOrigin === expectedOrigin) {
      return null
    }

    // The configured APP_URL and the address a request actually arrives on can
    // both be loopback (localhost vs. 127.0.0.1 on the same port) without either
    // side being attacker-controlled — treat those as the same origin. Scheme
    // must still match: http and https are different origins, and the request's
    // actual Origin header always reflects the scheme the browser really used.
    if (isEquivalentLoopbackOrigin(normalizedRequestOrigin, expectedOrigin, { requireSameProtocol: true })) {
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
