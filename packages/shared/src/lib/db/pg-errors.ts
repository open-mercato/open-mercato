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

const FOREIGN_KEY_VIOLATION_MESSAGE = /violates foreign key constraint(?: "([^"]+)")?/i

const MAX_ERROR_CHAIN_DEPTH = 4

/**
 * MikroORM wraps driver errors and copies the pg fields onto the wrapper, but
 * the original error may also sit behind `cause` (Node) or `previous`
 * (MikroORM), possibly re-wrapped by a transaction helper. Walk that chain,
 * breadth-first with a small depth cap, so a check works on any layer.
 */
function pgErrorCandidates(err: unknown): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  const seen = new Set<unknown>()
  let layer: unknown[] = [err]
  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH && layer.length > 0; depth += 1) {
    const next: unknown[] = []
    for (const candidate of layer) {
      if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue
      seen.add(candidate)
      const record = candidate as Record<string, unknown>
      found.push(record)
      next.push(record.cause, record.previous)
    }
    layer = next
  }
  return found
}

/**
 * Detect a Postgres foreign-key violation (SQLSTATE 23503): the row is still
 * referenced by a dependent table, or the payload references a parent that
 * does not exist. Looks through MikroORM's driver-error wrapping.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCandidates(err).some((candidate) => {
    if (candidate.code === '23503') return true // Postgres foreign_key_violation
    return typeof candidate.message === 'string' && FOREIGN_KEY_VIOLATION_MESSAGE.test(candidate.message)
  })
}

/**
 * Name of the constraint behind a foreign-key violation, read from the pg
 * `constraint` field on any layer of the wrapper chain, or parsed out of the
 * quoted constraint in the driver message when the field is missing.
 */
export function getForeignKeyViolationConstraint(err: unknown): string | null {
  for (const candidate of pgErrorCandidates(err)) {
    if (typeof candidate.constraint === 'string' && candidate.constraint.length > 0) return candidate.constraint
  }
  for (const candidate of pgErrorCandidates(err)) {
    if (typeof candidate.message !== 'string') continue
    const match = FOREIGN_KEY_VIOLATION_MESSAGE.exec(candidate.message)
    if (match?.[1]) return match[1]
  }
  return null
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
 * Postgres-driver / connection-pool messages that describe a transient DB
 * connection failure when the SQLSTATE is dropped by the ORM wrapper. These are
 * intentionally DB-specific phrases only. Bare socket codes (ECONNREFUSED,
 * ETIMEDOUT, …) are deliberately NOT matched: they can originate from any
 * outbound socket (HTTP, cache, queue), so keying off them would falsely
 * attribute unrelated failures to the database.
 */
const TRANSIENT_DB_MESSAGE_PATTERNS = [
  /too many clients already/i,
  /unable to acquire a connection/i,
  /timeout acquiring a connection/i,
  /connection terminated/i,
  /the database system is (starting up|shutting down|in recovery)/i,
]

/**
 * Detect a transient Postgres connection / availability failure (pool exhaustion,
 * `max_connections` reached, DB restarting) via its SQLSTATE or a DB-specific
 * driver message. Gates retryable 503 responses so callers do not report a
 * temporary infrastructure blip as an auth failure (401) or an unexpected server
 * error (500). Scoped to unambiguous DB signals so generic socket errors from
 * non-DB calls are never misclassified.
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
  if (typeof message === 'string' && TRANSIENT_DB_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }
  return false
}
