import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { RateLimitConfig, RateLimitGlobalConfig, RateLimitStrategy } from './types'

const VALID_STRATEGIES: RateLimitStrategy[] = ['memory', 'redis']
const logger = createLogger('ratelimit').child({ component: 'config' })

export function readRateLimitConfig(): RateLimitGlobalConfig {
  const strategy = (process.env.RATE_LIMIT_STRATEGY ?? 'memory') as RateLimitStrategy
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(`Invalid RATE_LIMIT_STRATEGY "${strategy}". Must be one of: ${VALID_STRATEGIES.join(', ')}`)
  }

  const trustProxyDepth = parseTrustProxyDepth(process.env.RATE_LIMIT_TRUST_PROXY_DEPTH)

  // Integration test runs disable rate limiting globally so suites do not
  // have to juggle per-endpoint bypass headers or reshape default caps.
  // The targeted OM_TEST_MODE + OM_TEST_AUTH_RATE_LIMIT_MODE=opt-in escape
  // hatch (checkAuthRateLimit) still works for suites that explicitly test
  // rate-limit behavior.
  const integrationTest = parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)
  const enabled = integrationTest
    ? false
    : parseBooleanWithDefault(process.env.RATE_LIMIT_ENABLED, true)

  return {
    enabled,
    strategy,
    keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX ?? 'rl',
    redisUrl: process.env.REDIS_URL,
    trustProxyDepth,
  }
}

/**
 * Read per-endpoint rate limit config from environment variables with hardcoded defaults.
 * Environment variable names follow the pattern: RATE_LIMIT_{PREFIX}_POINTS, RATE_LIMIT_{PREFIX}_DURATION, etc.
 */
export function readEndpointRateLimitConfig(
  envPrefix: string,
  defaults: { points: number; duration: number; blockDuration?: number; keyPrefix: string },
): RateLimitConfig {
  return {
    points: parsePositiveInt(process.env[`RATE_LIMIT_${envPrefix}_POINTS`]) ?? defaults.points,
    duration: parsePositiveInt(process.env[`RATE_LIMIT_${envPrefix}_DURATION`]) ?? defaults.duration,
    blockDuration: parsePositiveInt(process.env[`RATE_LIMIT_${envPrefix}_BLOCK_DURATION`]) ?? defaults.blockDuration,
    keyPrefix: defaults.keyPrefix,
  }
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseTrustProxyDepth(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed >= 0) return parsed
  logger.warn('Invalid RATE_LIMIT_TRUST_PROXY_DEPTH; using safe direct mode', { value: raw })
  return 0
}
