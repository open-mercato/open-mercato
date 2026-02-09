import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { RateLimitConfig, RateLimitGlobalConfig, RateLimitStrategy } from './types'

const VALID_STRATEGIES: RateLimitStrategy[] = ['memory', 'redis']

export function readRateLimitConfig(): RateLimitGlobalConfig {
  const strategy = (process.env.RATE_LIMIT_STRATEGY ?? 'memory') as RateLimitStrategy
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(`Invalid RATE_LIMIT_STRATEGY "${strategy}". Must be one of: ${VALID_STRATEGIES.join(', ')}`)
  }

  return {
    enabled: parseBooleanWithDefault(process.env.RATE_LIMIT_ENABLED, true),
    strategy,
    keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX ?? 'rl',
    redisUrl: process.env.REDIS_URL,
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
