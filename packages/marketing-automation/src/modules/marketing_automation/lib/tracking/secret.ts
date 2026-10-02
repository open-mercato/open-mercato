/**
 * The secret tracking tokens are signed with.
 *
 * A dedicated variable and nothing else. This used to fall back to `TENANT_DATA_ENCRYPTION_KEY` and
 * `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` so that tracking worked without an operator reading a
 * changelog, and that convenience was a forgery hole: `.env.example` publishes the fallback key as a
 * constant, so on any install that kept it, anybody could mint a token this module would accept —
 * a 302 to an arbitrary URL from the shop's own domain, writes into any scope, and forged
 * unsubscribe, survey and inbound tokens. Convenience that hands out the signing key is not
 * convenience. Unset means tracking is disabled, which is the safe way to be unconfigured.
 *
 * Session and JWT secrets are not candidates either, for the opposite reason: a tracking token is
 * handed to every recipient and lives in mail archives forever, so signing it with the secret that
 * mints sessions would widen the blast radius of that exposure enormously.
 */
const SIGNING_ENV_NAME = 'OM_MARKETING_TRACKING_SECRET'

/**
 * The previous secret, accepted on verification only.
 *
 * A tracking token has no expiry, deliberately: an unsubscribe link has to keep working for as long
 * as the message carrying it sits in somebody's mailbox. Without this, rotating the secret would
 * silently break every link already delivered, in the one place where failing is least acceptable —
 * somebody trying to be left alone.
 */
const PREVIOUS_ENV_NAME = 'OM_MARKETING_TRACKING_SECRET_PREVIOUS'

const CANDIDATE_ENV_NAMES = [SIGNING_ENV_NAME, PREVIOUS_ENV_NAME] as const

/**
 * Values this repository publishes, which therefore sign nothing.
 *
 * Refused rather than trusted because a published constant is a public key: an operator who pastes
 * one here, or who copies `.env.example` forward, would otherwise get tokens anyone can forge. The
 * `change-me` prefix is covered as a family, since no real secret begins with it.
 */
const PUBLISHED_PLACEHOLDER_SECRETS = new Set([
  'dev-tenant-encryption-fallback-key-32chars',
  'change-me-dev-secret',
  'change-me-dev-auth-secret',
])

function isPublishedPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase()
  return PUBLISHED_PLACEHOLDER_SECRETS.has(normalized) || normalized.startsWith('change-me')
}

export type EnvLike = Record<string, string | undefined>

/** Null when nothing usable is configured, which disables tracking rather than signing with a constant. */
export function resolveTrackingSecret(env: EnvLike = process.env): string | null {
  const value = env[SIGNING_ENV_NAME]?.trim()
  if (!value || isPublishedPlaceholder(value)) return null
  return value
}

/**
 * The secrets verification accepts, current first.
 *
 * Signing always uses `resolveTrackingSecret`; only verification reads this, so a rotation keeps
 * yesterday's links working while today's are minted with the new key.
 */
export function resolveTrackingSecrets(env: EnvLike = process.env): string[] {
  const secrets: string[] = []
  for (const name of CANDIDATE_ENV_NAMES) {
    const value = env[name]?.trim()
    if (!value || isPublishedPlaceholder(value)) continue
    // De-duplicated: the same key set in both variables must not cost two HMACs per verification.
    if (!secrets.includes(value)) secrets.push(value)
  }
  return secrets
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
