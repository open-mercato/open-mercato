import { randomBytes } from 'node:crypto'

/**
 * Generates a webhook secret following the Standard Webhooks specification.
 * Format: whsec_<base64url_random>
 *
 * The secret is at least 24 bytes (192 bits) of random data encoded in base64url format.
 * This provides sufficient entropy for HMAC-SHA256 signature generation.
 *
 * @returns The generated webhook secret string
 */
export function generateWebhookSecret(): string {
  const randomPart = randomBytes(32).toString('base64url')
  return `whsec_${randomPart}`
}

/**
 * Default retry configuration for webhooks
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  retryBackoff: 'exponential' as const,
  retryDelay: 1000,
}

/**
 * Default timeout for webhook delivery (in milliseconds)
 */
export const DEFAULT_TIMEOUT = 10000
