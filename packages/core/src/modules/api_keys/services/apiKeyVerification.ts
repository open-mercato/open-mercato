import { performance } from 'node:perf_hooks'
import { compare } from 'bcryptjs'
import { createApiKeyAuthCache } from '@open-mercato/shared/lib/auth/apiKeyAuthCache'

const MAX_CONCURRENT = 2
const BURST = 4
const REFILL_PER_SECOND = 8
const CACHE_TTL_MS = 10_000
const MAX_CACHE_ENTRIES = 1024
const results = createApiKeyAuthCache({
  successTtlMs: CACHE_TTL_MS,
  negativeTtlMs: CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
  now: () => performance.now(),
})
let active = 0
let tokens = BURST
let lastRefill = performance.now()

export async function verifyApiKeyHash(secret: string, keyHash: string): Promise<boolean> {
  if (!/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(keyHash)) return false

  const now = performance.now()
  const cacheKey = `${keyHash}\0${secret}`
  const cached = results.get(cacheKey)
  if (cached !== undefined) return cached !== null

  tokens = Math.min(BURST, tokens + Math.max(0, now - lastRefill) * REFILL_PER_SECOND / 1000)
  lastRefill = now
  if (active >= MAX_CONCURRENT || tokens < 1) return false

  tokens -= 1
  active += 1
  try {
    const valid = await compare(secret, keyHash)
    if (valid) results.setSuccess(cacheKey, {}, null)
    else results.setMiss(cacheKey)
    return valid
  } finally {
    active -= 1
  }
}
