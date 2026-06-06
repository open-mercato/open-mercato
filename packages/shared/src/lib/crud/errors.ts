// Use Symbol.for so the marker survives module duplication across bundle boundaries
// (same behaviour as globalThis-based registries used for DI registrars)
const CRUD_HTTP_ERROR_MARKER = Symbol.for('@open-mercato/CrudHttpError')

export class CrudHttpError extends Error {
  readonly [CRUD_HTTP_ERROR_MARKER] = true
  status: number
  body: Record<string, any>

  constructor(
    status: number,
    body?: Record<string, any> | string,
    options?: { cause?: unknown },
  ) {
    const normalizedBody = typeof body === 'string' ? { error: body } : body ?? {}
    super(typeof body === 'string' ? body : normalizedBody.error ?? 'Request failed', options)
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

export function conflict(message: string): CrudHttpError {
  return new CrudHttpError(409, { error: message })
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Detects a Postgres unique-constraint violation (SQLSTATE 23505) on a thrown
 * error, looking through MikroORM's driver-error wrapping. Use this to map a DB
 * uniqueness race (e.g. a soft-deleted row the in-app check missed, or a
 * timestamp-precision mismatch) onto a clean 409 instead of a generic 500.
 */
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (!err || typeof err !== 'object') return false
  const candidates: unknown[] = [err, (err as { cause?: unknown }).cause, (err as { previous?: unknown }).previous]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    if (record.code === POSTGRES_UNIQUE_VIOLATION) {
      if (!constraintName) return true
      const constraint = typeof record.constraint === 'string' ? record.constraint : ''
      const detail = typeof record.detail === 'string' ? record.detail : ''
      const message = typeof record.message === 'string' ? record.message : ''
      return constraint === constraintName || detail.includes(constraintName) || message.includes(constraintName)
    }
  }
  return false
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) throw notFound(message)
  return value
}
