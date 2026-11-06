export class ApiKeyVerificationRateLimitError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('[internal] API-key verification is temporarily rate limited')
    this.name = 'ApiKeyVerificationRateLimitError'
    this.retryAfterMs = Math.max(1, Math.ceil(retryAfterMs))
  }
}
