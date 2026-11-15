import { parseNumberWithDefault } from '../number'

export const SSE_AUTH_REVALIDATION_INTERVAL_ENV = 'OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS'
export const SSE_CONNECTION_MAX_AGE_ENV = 'OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS'

const DEFAULT_AUTH_REVALIDATION_INTERVAL_MS = 30_000
const DEFAULT_CONNECTION_MAX_AGE_MS = 5 * 60_000
const MIN_AUTH_REVALIDATION_INTERVAL_MS = 1_000
const MIN_CONNECTION_MAX_AGE_MS = 1_000
const CONNECTION_MAX_AGE_JITTER_RATIO = 0.15
const MAX_TIMER_DELAY_MS = 2_147_483_647

export type SseConnectionBounds = {
  authRevalidationIntervalMs: number
  connectionMaxAgeMs: number
}

/**
 * Per-connection timing shared by the DOM Event Bridge and the Portal Event Bridge.
 * Reads the env on every call so each new stream picks up the current bounds; the
 * max age gets ±15% jitter so streams opened together do not reconnect together.
 */
export function resolveSseConnectionBounds(env: NodeJS.ProcessEnv = process.env): SseConnectionBounds {
  return {
    authRevalidationIntervalMs: Math.min(
      parseNumberWithDefault(
        env[SSE_AUTH_REVALIDATION_INTERVAL_ENV],
        DEFAULT_AUTH_REVALIDATION_INTERVAL_MS,
        { integer: true, min: MIN_AUTH_REVALIDATION_INTERVAL_MS },
      ),
      MAX_TIMER_DELAY_MS,
    ),
    connectionMaxAgeMs: applyConnectionMaxAgeJitter(
      parseNumberWithDefault(
        env[SSE_CONNECTION_MAX_AGE_ENV],
        DEFAULT_CONNECTION_MAX_AGE_MS,
        { integer: true, min: MIN_CONNECTION_MAX_AGE_MS },
      ),
    ),
  }
}

function applyConnectionMaxAgeJitter(configuredMs: number): number {
  const jitterFactor = 1 + (Math.random() * 2 - 1) * CONNECTION_MAX_AGE_JITTER_RATIO
  const jitteredMs = Math.round(configuredMs * jitterFactor)
  return Math.min(Math.max(jitteredMs, MIN_CONNECTION_MAX_AGE_MS), MAX_TIMER_DELAY_MS)
}
