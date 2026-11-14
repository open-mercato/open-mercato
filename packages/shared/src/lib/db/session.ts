import { canonicalizeTimeZone } from '../date/timezone'

export const DB_DEFAULT_TIMEZONE_ENV = 'OM_DB_DEFAULT_TIMEZONE'

/**
 * Resolves the optional Postgres session `TimeZone` from `OM_DB_DEFAULT_TIMEZONE`.
 * Unset or blank returns `undefined` so connections keep the server default.
 * An unresolvable zone throws: Postgres would reject every connection with it anyway.
 */
export function resolveDbSessionTimeZone(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[DB_DEFAULT_TIMEZONE_ENV]
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const canonical = canonicalizeTimeZone(raw)
  if (!canonical) {
    throw new Error(
      `[internal] ${DB_DEFAULT_TIMEZONE_ENV}="${raw.trim()}" is not a valid IANA time zone (for example "UTC" or "Europe/Warsaw")`,
    )
  }
  return canonical
}

export type PgSessionOptionsInput = {
  idleSessionTimeoutMs?: number
  timeZone?: string
}

/**
 * Builds the libpq `options` startup string (`-c key=value ...`) for a pg connection,
 * or `undefined` when there is nothing to set.
 */
export function buildPgSessionOptions({ idleSessionTimeoutMs, timeZone }: PgSessionOptionsInput): string | undefined {
  const flags: string[] = []
  if (idleSessionTimeoutMs && idleSessionTimeoutMs > 0) flags.push(`-c idle_session_timeout=${idleSessionTimeoutMs}`)
  if (timeZone) flags.push(`-c TimeZone=${timeZone}`)
  return flags.length ? flags.join(' ') : undefined
}

/**
 * Session options for connections opened outside the main ORM pool (CLI clients, event bridge,
 * pgvector). Spread into a `pg.Client` / `pg.Pool` config: `{ connectionString, ...getPgSessionConfig() }`.
 */
export function getPgSessionConfig(env: NodeJS.ProcessEnv = process.env): { options?: string } {
  const options = buildPgSessionOptions({ timeZone: resolveDbSessionTimeZone(env) })
  return options ? { options } : {}
}
