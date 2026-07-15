export type WebSearchErrorCode =
  | 'ssrf_blocked'
  | 'provider_unhealthy'
  | 'timeout'
  | 'bad_response'
  | 'too_many_redirects'
  | 'unsupported'

export class WebSearchProviderError extends Error {
  readonly code: WebSearchErrorCode

  constructor(code: WebSearchErrorCode, message: string) {
    super(message)
    this.name = 'WebSearchProviderError'
    this.code = code
  }
}

export function isWebSearchProviderError(value: unknown): value is WebSearchProviderError {
  return value instanceof WebSearchProviderError
}
