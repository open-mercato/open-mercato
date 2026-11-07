import { performance } from 'node:perf_hooks'
import { compare } from 'bcryptjs'
import { ApiKeyVerificationRateLimitError } from '@open-mercato/shared/lib/auth/apiKeyVerificationRateLimit'

const MIN_RECOVERY_MS = 250
const RECOVERY_MULTIPLIER = 3
let active = false
let nextAllowedAt = 0

export async function verifyApiKeyHash(secret: string, keyHash: string): Promise<boolean> {
  if (!/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(keyHash)) return false

  const startedAt = performance.now()
  if (active || startedAt < nextAllowedAt) {
    throw new ApiKeyVerificationRateLimitError(active ? 1000 : nextAllowedAt - startedAt)
  }

  active = true
  try {
    return await compare(secret, keyHash)
  } finally {
    const finishedAt = performance.now()
    const durationMs = Math.max(0, finishedAt - startedAt)
    nextAllowedAt = finishedAt + Math.max(MIN_RECOVERY_MS, durationMs * RECOVERY_MULTIPLIER)
    active = false
  }
}
