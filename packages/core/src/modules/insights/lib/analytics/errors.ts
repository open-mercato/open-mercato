export type XrayAnalyticsErrorCode =
  | 'invalid_request'
  | 'invalid_window'
  | 'window_too_large'
  | 'query_timeout'
  | 'result_too_large'
  | 'process_not_found'
  | 'individuals_denied'

export type XrayAnalyticsErrorHint = 'run_background_analysis' | 'narrow_filters' | null

export type IndividualsDeniedReason =
  | 'feature_missing'
  | 'setting_disabled'
  | 'viewer_unknown'
  | 'no_organization'
  | 'access_log_unavailable'
  | 'access_log_failed'

/**
 * Typed failure of an X-Ray analytics call. `status` is the HTTP status the API routes map it
 * to; `hint` tells the caller what to do instead (e.g. run a background analysis job). The
 * message is internal and never shown verbatim.
 */
export class XrayAnalyticsError extends Error {
  readonly code: XrayAnalyticsErrorCode
  readonly status: number
  readonly hint: XrayAnalyticsErrorHint

  constructor(code: XrayAnalyticsErrorCode, status: number, message: string, hint: XrayAnalyticsErrorHint = null) {
    super(`[internal] ${message}`)
    this.name = 'XrayAnalyticsError'
    this.code = code
    this.status = status
    this.hint = hint
  }
}

export class AnalyticsInvalidRequestError extends XrayAnalyticsError {
  readonly issues: string[]

  constructor(issues: string[]) {
    super('invalid_request', 400, 'The X-Ray analytics request is invalid')
    this.name = 'AnalyticsInvalidRequestError'
    this.issues = issues
  }
}

export class AnalyticsInvalidWindowError extends XrayAnalyticsError {
  readonly reason: 'empty_window' | 'invalid_bounds' | 'invalid_time_zone'

  constructor(reason: 'empty_window' | 'invalid_bounds' | 'invalid_time_zone') {
    super('invalid_window', 400, `The X-Ray analytics window is invalid (${reason})`)
    this.name = 'AnalyticsInvalidWindowError'
    this.reason = reason
  }
}

export class AnalyticsWindowTooLargeError extends XrayAnalyticsError {
  readonly maxDays: number

  constructor(maxDays: number) {
    super('window_too_large', 422, `The X-Ray analytics window exceeds ${maxDays} days`, 'run_background_analysis')
    this.name = 'AnalyticsWindowTooLargeError'
    this.maxDays = maxDays
  }
}

export class AnalyticsTimeoutError extends XrayAnalyticsError {
  constructor() {
    super('query_timeout', 422, 'The X-Ray analytics query exceeded its statement timeout', 'run_background_analysis')
    this.name = 'AnalyticsTimeoutError'
  }
}

export class AnalyticsTooLargeError extends XrayAnalyticsError {
  readonly limit: number

  constructor(limit: number) {
    super('result_too_large', 422, `The X-Ray analytics query would read more than ${limit} events`, 'run_background_analysis')
    this.name = 'AnalyticsTooLargeError'
    this.limit = limit
  }
}

export class AnalyticsProcessNotFoundError extends XrayAnalyticsError {
  constructor() {
    super('process_not_found', 404, 'The X-Ray process is not registered')
    this.name = 'AnalyticsProcessNotFoundError'
  }
}

export class AnalyticsIndividualsDeniedError extends XrayAnalyticsError {
  readonly reason: IndividualsDeniedReason

  constructor(reason: IndividualsDeniedReason) {
    super('individuals_denied', 403, `Per-person X-Ray analytics are not available (${reason})`)
    this.name = 'AnalyticsIndividualsDeniedError'
    this.reason = reason
  }
}

export function isXrayAnalyticsError(error: unknown): error is XrayAnalyticsError {
  return error instanceof XrayAnalyticsError
}
