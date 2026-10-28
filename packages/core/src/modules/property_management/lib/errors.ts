import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

async function httpError(status: number, key: string, fallback: string, extra?: Record<string, unknown>, params?: Record<string, string | number>): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { error: translate(key, fallback, params), ...(extra ?? {}) })
}

export function conflictError(key: string, fallback: string, extra?: Record<string, unknown>, params?: Record<string, string | number>) {
  return httpError(409, key, fallback, extra, params)
}

export function unprocessableError(key: string, fallback: string, extra?: Record<string, unknown>, params?: Record<string, string | number>) {
  return httpError(422, key, fallback, extra, params)
}

export function forbiddenError(key: string, fallback: string, extra?: Record<string, unknown>) {
  return httpError(403, key, fallback, extra)
}

export function notFoundError(key: string, fallback: string, extra?: Record<string, unknown>) {
  return httpError(404, key, fallback, extra)
}
