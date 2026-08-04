/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) regardless of
 * the ORM/driver layer that surfaces it. Shared across modules so duplicate-insert
 * handling stays consistent platform-wide.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === '23505') return true // Postgres unique_violation
  const message = (err as { message?: string }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}

/**
 * Postgres SQLSTATEs for transient connection / availability failures — the
 * database (or its connection pool) is temporarily unreachable and the request
 * can succeed on retry. Deliberately scoped to connection/availability codes;
 * query-level conflicts (deadlock 40P01, serialization 40001, lock_not_available
 * 55P03) are NOT included because they do not mean "service unavailable".
 */
const TRANSIENT_CONNECTION_SQLSTATES = new Set([
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (db starting up)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
])

/**
 * Driver/ORM-wrapped errors that drop the SQLSTATE but still describe a transient
 * connection failure (pool-acquire timeouts, socket errors, DB restarting). The
 * SQLSTATE on `.code` is the primary signal; these catch the wrapped-message case.
 */
const TRANSIENT_CONNECTION_PATTERNS = [
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /too many clients already/i,
  /unable to acquire a connection/i,
  /timeout acquiring a connection/i,
  /connection terminated/i,
  /connection not available/i,
  /the database system is (starting up|shutting down|in recovery)/i,
]

/**
 * Detect a transient Postgres connection / availability failure (pool exhaustion,
 * `max_connections` reached, DB restarting, socket drop) regardless of the
 * ORM/driver layer that surfaces it. Gates retryable 503 responses so callers do
 * not report a temporary infrastructure blip as an auth failure (401) or an
 * unexpected server error (500).
 */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }
  const code = (err as { code?: string }).code
  if (typeof code === 'string' && TRANSIENT_CONNECTION_SQLSTATES.has(code)) {
    return true
  }
  const message = (err as { message?: string }).message
  if (typeof message === 'string' && TRANSIENT_CONNECTION_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }
  return typeof code === 'string' && TRANSIENT_CONNECTION_PATTERNS.some((pattern) => pattern.test(code))
}
