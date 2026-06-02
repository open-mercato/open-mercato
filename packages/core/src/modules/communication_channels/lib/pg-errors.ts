/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) regardless of
 * the ORM/driver layer that surfaces it. Shared across the hub's commands and
 * lib helpers so duplicate-insert handling stays consistent module-wide.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === '23505') return true // Postgres unique_violation
  const message = (err as { message?: string }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}
