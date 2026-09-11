export type WebResearchErrorCode =
  | 'ssrf_blocked'
  | 'timeout'
  | 'aborted'
  | 'blocked'
  | 'bad_response'
  | 'too_many_redirects'
  | 'unsupported_content_type'
  | 'network'

export type WebResearchErrorInit = {
  readonly retryAfterMs?: number
  readonly status?: number
  readonly cause?: unknown
}

export class WebResearchError extends Error {
  /**
   * Brand checked by {@link isWebResearchError} instead of `instanceof`. The
   * package resolves as raw `src` for typecheck and as built `dist` at runtime,
   * so a value can cross a realm where the two class identities differ.
   */
  readonly __webResearchError = true as const
  readonly code: WebResearchErrorCode
  readonly retryAfterMs?: number
  readonly status?: number

  constructor(code: WebResearchErrorCode, message: string, init: WebResearchErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'WebResearchError'
    this.code = code
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs
    if (init.status !== undefined) this.status = init.status
  }
}

export function isWebResearchError(value: unknown): value is WebResearchError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __webResearchError?: unknown }).__webResearchError === true
  )
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}
