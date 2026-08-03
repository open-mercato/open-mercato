/**
 * End-user safety identifiers for AI provider calls.
 *
 * Providers such as OpenAI let developers attach an opaque per-end-user
 * identifier to each request so abuse enforcement can target one user instead
 * of suspending the whole API-key organization. We never send a reversible id:
 * the value is a tenant-salted HMAC computed from the platform's existing auth
 * secret, so no PII or internal id leaves the platform and the same end user in
 * two tenants produces two unrelated hashes.
 *
 * The per-process secret derivation mirrors `deriveJwtAudienceSecret`
 * (`@open-mercato/shared/lib/auth/jwt`): one HMAC from the base `JWT_SECRET`
 * under a versioned purpose label, memoized for the process lifetime. No new
 * secret to provision.
 *
 * @see .ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md
 */

import crypto from 'node:crypto'

const SAFETY_IDENTIFIER_SECRET_LABEL = 'open-mercato:ai-safety-identifier:v1'

const derivedSecretCache = new Map<string, string>()

function readBaseSecret(explicit?: string): string {
  const secret = explicit ?? process.env.JWT_SECRET
  if (!secret) {
    throw new Error('[internal] JWT_SECRET is not set; cannot derive AI safety-identifier secret')
  }
  return secret
}

/**
 * Derive the per-process safety-identifier HMAC key from the base auth secret.
 *
 * Deterministic HMAC-SHA256 of a versioned purpose label keyed by the base
 * secret, memoized per base secret. Rotating the base secret rotates every
 * derived identifier — documented as accepted (identifiers are advisory
 * provider-side metadata, not an in-platform security control).
 */
export function deriveAiSafetyIdentifierSecret(baseSecret?: string): string {
  const base = readBaseSecret(baseSecret)
  const cached = derivedSecretCache.get(base)
  if (cached !== undefined) return cached
  const derived = crypto
    .createHmac('sha256', base)
    .update(SAFETY_IDENTIFIER_SECRET_LABEL)
    .digest('hex')
  derivedSecretCache.set(base, derived)
  return derived
}

/**
 * Compute the opaque end-user safety identifier for a (tenant, user) pair.
 *
 * Returns a 64-char lowercase hex HMAC-SHA256 of `${tenantId}:${userId}` keyed
 * by the derived secret. Throws (with an `[internal]` message) when the base
 * secret is missing or `userId` is empty — callers in the runtime wrap this in
 * a best-effort try/catch so identifier-derivation failures never break chat.
 */
export function computeEndUserIdentifier(
  tenantId: string | null | undefined,
  userId: string,
  options?: { baseSecret?: string },
): string {
  const normalizedUser = (userId ?? '').trim()
  if (!normalizedUser) {
    throw new Error('[internal] computeEndUserIdentifier requires a non-empty userId')
  }
  const key = deriveAiSafetyIdentifierSecret(options?.baseSecret)
  const salt = (tenantId ?? '').trim()
  return crypto.createHmac('sha256', key).update(`${salt}:${normalizedUser}`).digest('hex')
}
