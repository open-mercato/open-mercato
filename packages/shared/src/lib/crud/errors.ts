export class CrudHttpError extends Error {
  status: number
  body: Record<string, any>

  constructor(status: number, body?: Record<string, any> | string) {
    const normalizedBody = typeof body === 'string' ? { error: body } : body ?? {}
    super(typeof body === 'string' ? body : normalizedBody.error ?? 'Request failed')
    this.status = status
    this.body = normalizedBody
  }
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
