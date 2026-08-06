// Use Symbol.for so the marker survives module duplication across bundle boundaries
// (same behaviour as CrudHttpError and the globalThis-based DI registries)
const COMMAND_INTERCEPTOR_ERROR_MARKER = Symbol.for('@open-mercato/CommandInterceptorError')

export type CommandInterceptorErrorOptions = {
  /** HTTP status the transport layer should answer with. Omit to keep the generic 500. */
  status?: number
  /**
   * Response body the transport layer should answer with, defaulting to `{ error: message }`.
   * Only meaningful together with `status` — a body on its own is ignored, mirroring the same
   * rule on `CommandInterceptorBeforeResult`.
   */
  body?: Record<string, unknown>
  cause?: unknown
}

export class CommandInterceptorError extends Error {
  readonly [COMMAND_INTERCEPTOR_ERROR_MARKER] = true
  /**
   * HTTP status a deliberate interceptor rejection wants to surface. `undefined` when the
   * interceptor supplied none, in which case the transport layer keeps its generic 500.
   */
  readonly status?: number
  /**
   * Response body for the rejection — `options.body`, else `{ error: message }`. Set only
   * alongside `status`, so the two are always populated together or not at all.
   */
  readonly body?: Record<string, unknown>

  constructor(message: string, options?: CommandInterceptorErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'CommandInterceptorError'
    if (typeof options?.status === 'number') {
      this.status = options.status
      this.body = options.body ?? { error: message }
    }
  }
}

/**
 * Type-safe check for CommandInterceptorError that works across module/bundle boundaries.
 * Prefer this over `instanceof CommandInterceptorError` whenever the error may originate
 * from a different module bundle (e.g. enterprise packages, dynamic imports).
 */
export function isCommandInterceptorError(err: unknown): err is CommandInterceptorError {
  return !!err && typeof err === 'object'
    && (err as Record<symbol, unknown>)[COMMAND_INTERCEPTOR_ERROR_MARKER] === true
}
