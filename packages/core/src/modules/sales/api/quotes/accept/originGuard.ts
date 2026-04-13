import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

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
