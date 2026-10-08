const DATABASE_ERROR_CODE_PATTERN = /^[0-9A-Z]{5}$/
const STATEMENT_TIMEOUT_CODE = '57014'
const LOCK_NOT_AVAILABLE_CODE = '55P03'
const INTERNAL_MESSAGE_PREFIX = '[internal] '
const MAX_CAUSE_DEPTH = 4
const MAX_DESCRIPTION_LENGTH = 500

function readDatabaseErrorCode(error: unknown, depth = 0): string | null {
  if (!error || typeof error !== 'object' || depth > MAX_CAUSE_DEPTH) return null
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && DATABASE_ERROR_CODE_PATTERN.test(code)) return code
  return readDatabaseErrorCode((error as { cause?: unknown }).cause, depth + 1)
}

/** Whether PostgreSQL cancelled the statement on its `statement_timeout` (SQLSTATE 57014). */
export function isStatementTimeoutError(error: unknown): boolean {
  return readDatabaseErrorCode(error) === STATEMENT_TIMEOUT_CODE
}

/** Whether PostgreSQL gave up waiting for a lock on its `lock_timeout` (SQLSTATE 55P03). */
export function isLockTimeoutError(error: unknown): boolean {
  return readDatabaseErrorCode(error) === LOCK_NOT_AVAILABLE_CODE
}

/**
 * A description of an ingest failure that is safe to persist on the cursor and show to
 * managers: the platform's own `[internal]` messages verbatim, anything else only by its
 * error name and SQLSTATE (database messages can quote row values).
 */
export function describeXrayError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith(INTERNAL_MESSAGE_PREFIX)) {
    return error.message.slice(0, MAX_DESCRIPTION_LENGTH)
  }
  const name = error instanceof Error && error.name ? error.name : 'Error'
  const code = readDatabaseErrorCode(error)
  return code ? `${name} (SQLSTATE ${code})` : name
}
