// Reserved for framework authentication-capacity rejection that is safe to replay.
export const API_KEY_VERIFICATION_THROTTLE_HEADER = 'x-om-api-key-verification-throttled'

export class ApiKeyVerificationRateLimitError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('[internal] API-key verification is temporarily rate limited')
    this.name = 'ApiKeyVerificationRateLimitError'
    this.retryAfterMs = Math.max(1, Math.ceil(retryAfterMs))
  }
}
