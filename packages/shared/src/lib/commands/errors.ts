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

export type CommandInterceptorHttpRejection = {
  status: number
  body: Record<string, unknown>
}

const MIN_REJECTION_STATUS = 400
const MAX_REJECTION_STATUS = 599

/**
 * Transport data for a deliberate interceptor rejection, or `null` when the error is not one or
 * carries no usable status. The status is restricted to 4xx/5xx on purpose: interceptor data is
 * third-party input travelling through the runner and the bus, `new Response(body, { status })`
 * throws `RangeError` outside 200-599, and a rejection answered with a 2xx would report a block as
 * a success. Anything else falls through to the caller's generic handling.
 */
export function getCommandInterceptorHttpRejection(err: unknown): CommandInterceptorHttpRejection | null {
  if (!isCommandInterceptorError(err)) return null
  const status = err.status
  if (typeof status !== 'number' || !Number.isInteger(status)) return null
  if (status < MIN_REJECTION_STATUS || status > MAX_REJECTION_STATUS) return null
  return { status, body: err.body ?? { error: err.message } }
}
