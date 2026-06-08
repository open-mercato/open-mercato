import { createHash } from 'node:crypto'

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

/**
 * Derive a stable, non-reversible session-memory id from an API key secret.
 * The same secret always maps to the same id (so tool calls on one MCP
 * connection share a memory cache), but no secret material is exposed because
 * the id is a truncated SHA-256 digest rather than a slice of the secret.
 */
export function deriveApiKeySessionId(apiKeySecret: string): string {
  const digest = createHash('sha256').update(apiKeySecret).digest('hex')
  return `apikey_${digest.slice(0, 16)}`
}
