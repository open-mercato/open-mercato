export type XeroApiErrorCode =
  | 'scope_insufficient'
  | 'unauthorized'
  | 'forbidden'
  | 'organisation_not_authorised'
  | 'daily_limit'
  | 'rate_limited'
  | 'transient'
  | 'request_rejected'

export class XeroApiError extends Error {
  readonly code: XeroApiErrorCode
  readonly status: number | null

  constructor(code: XeroApiErrorCode, options: { status?: number | null; cause?: unknown } = {}) {
    const status = options.status ?? null
    super(
      status === null ? `[internal] Xero API call failed: ${code}` : `[internal] Xero API call failed: ${code} (HTTP ${status})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'XeroApiError'
    this.code = code
    this.status = status
  }
}

export function isXeroApiError(value: unknown): value is XeroApiError {
  return value instanceof XeroApiError
}
