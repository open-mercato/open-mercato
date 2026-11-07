import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { API_KEY_VERIFICATION_THROTTLE_HEADER, ApiKeyVerificationRateLimitError } from './apiKeyVerificationRateLimit'

const MAX_RETRIES = 3
const RETRY_WINDOW_MS = 10_000

/**
 * For validated, same-origin platform API URLs and replayable JSON request bodies.
 * Only the framework's marked authentication-only rejection is safe to replay.
 * Redirects remain manual so credentials cannot escape the caller's URL policy.
 */
export async function fetchWithApiKeyVerificationRetry(
  url: string,
  init: RequestInit & { body?: string },
): Promise<Response> {
  const startedAt = performance.now()
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted()
    const response = await fetch(url, { ...init, redirect: 'manual' })
    if (
      response.status !== 429
      || response.headers.get(API_KEY_VERIFICATION_THROTTLE_HEADER) !== '1'
      || attempt >= MAX_RETRIES
    ) return response

    const retryAfter = response.headers.get('retry-after') ?? ''
    const waitMs = Number(retryAfter) * 1000
    if (
      !/^[1-9]\d*$/.test(retryAfter)
      || !Number.isFinite(waitMs)
      || performance.now() - startedAt + waitMs > RETRY_WINDOW_MS
    ) return response

    await response.body?.cancel()
    await delay(waitMs, undefined, { signal: init.signal ?? undefined })
    init.signal?.throwIfAborted()
    if (performance.now() - startedAt >= RETRY_WINDOW_MS) {
      throw new ApiKeyVerificationRateLimitError(waitMs)
    }
  }
}
