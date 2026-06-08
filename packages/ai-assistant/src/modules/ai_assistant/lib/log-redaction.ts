import { pbkdf2Sync, randomBytes } from 'node:crypto'

/**
 * Redact a bearer-style secret (session token, API key) for safe logging.
 * Reveals at most a short leading fingerprint and never more than half of the
 * value, so durable logs never carry a replayable credential.
 */
export function redactSecretForLog(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '<redacted>'
  const prefixLength = Math.min(12, Math.floor(value.length / 2))
  if (prefixLength <= 0) return '<redacted>'
  return `${value.slice(0, prefixLength)}...`
}

// Per-process random key so the API key secret is fingerprinted through a keyed
// HMAC rather than a fast, unkeyed digest. The session id is only an in-process
// grouping key for the session-memory cache (a process-local Map), so a key that
// lives for the process lifetime keeps the same-secret-maps-to-same-id guarantee
// within an MCP connection while ensuring the digest is not derivable from the
// secret alone. Mirrors the secret fingerprinter in apiKeyAuthCache.ts.
const sessionIdHmacKey = randomBytes(32)
const SESSION_ID_PBKDF2_ITERATIONS = 210000
const SESSION_ID_PBKDF2_KEYLEN = 16

/**
 * Derive a stable, non-reversible session-memory id from an API key secret.
 * The same secret always maps to the same id within a process (so tool calls on
 * one MCP connection share a memory cache), but no secret material is exposed:
 * the id is derived with PBKDF2 (slow KDF) using a per-process random salt.
 */
export function deriveApiKeySessionId(apiKeySecret: string): string {
  const digest = pbkdf2Sync(
    apiKeySecret,
    sessionIdHmacKey,
    SESSION_ID_PBKDF2_ITERATIONS,
    SESSION_ID_PBKDF2_KEYLEN,
    'sha256'
  ).toString('hex')
  return `apikey_${digest}`
}
