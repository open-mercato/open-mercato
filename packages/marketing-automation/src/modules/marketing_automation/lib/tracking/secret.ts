/**
 * The secret tracking tokens are signed with.
 *
 * Deliberately falls back to the platform's data-encryption key material rather than requiring a new
 * variable: tracking that only works after an operator reads a changelog is tracking that quietly
 * does nothing. The key is domain-separated before use (see `token.ts`), so sharing the secret with
 * encryption at rest cannot let one be derived from the other.
 *
 * Session and JWT secrets are deliberately NOT candidates. A tracking token is handed to every
 * recipient and lives in mail archives forever; signing it with the secret that mints sessions would
 * widen the blast radius of that exposure from "somebody can forge an open event" to something far
 * worse.
 */
const CANDIDATE_ENV_NAMES = [
  'OM_MARKETING_TRACKING_SECRET',
  'TENANT_DATA_ENCRYPTION_KEY',
  'TENANT_DATA_ENCRYPTION_FALLBACK_KEY',
] as const

export type EnvLike = Record<string, string | undefined>

/** Null when nothing is configured, which disables tracking rather than signing with a constant. */
export function resolveTrackingSecret(env: EnvLike = process.env): string | null {
  for (const name of CANDIDATE_ENV_NAMES) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return null
}

export function trackingSecretEnvNames(): readonly string[] {
  return CANDIDATE_ENV_NAMES
}

const DEFAULT_DEV_BASE_URL = 'http://localhost:3000'

/**
 * The absolute base a tracking URL is built on.
 *
 * A step runs in a worker with no request to derive an origin from, so this is configuration or
 * nothing. In production an unset `APP_URL` disables tracking rather than emitting links to
 * localhost that every recipient would see fail.
 */
export function resolveTrackingBaseUrl(env: EnvLike = process.env): string | null {
  const configured = (env.APP_URL || env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  return env.NODE_ENV === 'production' ? null : DEFAULT_DEV_BASE_URL
}
