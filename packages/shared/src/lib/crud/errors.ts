// Use Symbol.for so the marker survives module duplication across bundle boundaries
// (same behaviour as globalThis-based registries used for DI registrars)
const CRUD_HTTP_ERROR_MARKER = Symbol.for('@open-mercato/CrudHttpError')

export class CrudHttpError extends Error {
  readonly [CRUD_HTTP_ERROR_MARKER] = true
  status: number
  body: Record<string, any>

  constructor(status: number, body?: Record<string, any> | string) {
    const normalizedBody = typeof body === 'string' ? { error: body } : body ?? {}
    super(typeof body === 'string' ? body : normalizedBody.error ?? 'Request failed')
    this.status = status
    this.body = normalizedBody
  }
}

/**
 * Type-safe check for CrudHttpError that works across module/bundle boundaries.
 * Prefer this over `instanceof CrudHttpError` whenever the error may originate
 * from a different module bundle (e.g. enterprise packages, dynamic imports).
 */
export function isCrudHttpError(err: unknown): err is CrudHttpError {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[CRUD_HTTP_ERROR_MARKER] === true
}

export function badRequest(message: string): CrudHttpError {
  return new CrudHttpError(400, { error: message })
}

export function forbidden(message = 'Forbidden'): CrudHttpError {
  return new CrudHttpError(403, { error: message })
}

export function notFound(message = 'Not found'): CrudHttpError {
  return new CrudHttpError(404, { error: message })
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) throw notFound(message)
  return value
}
