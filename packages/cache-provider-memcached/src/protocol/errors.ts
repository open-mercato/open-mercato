export type MemcachedProtocolErrorCode =
  | 'timeout'
  | 'unavailable'
  | 'closed'
  | 'item_too_large'
  | 'invalid_key'
  | 'command_too_large'
  | 'client_error'
  | 'server_error'
  | 'protocol_error'

export class MemcachedProtocolError extends Error {
  public readonly code: MemcachedProtocolErrorCode
  declare public readonly originalError?: unknown

  constructor(code: MemcachedProtocolErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'MemcachedProtocolError'
    this.code = code
    Object.defineProperty(this, 'originalError', {
      value: options.cause,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }

  toJSON(): { name: string; code: MemcachedProtocolErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message }
  }
}

export function isMemcachedProtocolError(error: unknown): error is MemcachedProtocolError {
  return error instanceof MemcachedProtocolError
    || (error instanceof Error && error.name === 'MemcachedProtocolError' && typeof (error as { code?: unknown }).code === 'string')
}

/**
 * Connection-level failures leave the request outcome unknown: the command may
 * or may not have reached the server. Callers must not assume it was applied.
 */
export function isMemcachedConnectionError(error: unknown): boolean {
  return isMemcachedProtocolError(error) && (error.code === 'timeout' || error.code === 'unavailable' || error.code === 'closed')
}
