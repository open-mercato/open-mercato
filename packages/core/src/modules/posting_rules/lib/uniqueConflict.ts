import { conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'

/**
 * Maps a Postgres unique violation on `constraint` raised by `run` to a
 * translated 409. The commands check uniqueness with a `findOne` first, but two
 * concurrent requests can both pass that check; the second insert then fails on
 * the DB unique index. `makeCrudRoute`'s error handler has no unique-violation
 * branch (only `CrudHttpError`, Zod, transient-DB and foreign-key cases), so an
 * unmapped violation would reach the client as a generic 500.
 */
export async function withUniqueConflict<T>(
  constraint: string,
  message: () => string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (isUniqueViolation(err, constraint)) throw conflict(message())
    throw err
  }
}

export const COST_CENTER_CODE_UNIQUE = 'posting_rules_cost_centers_scope_code_unique'
export const DEFAULT_ACCOUNT_POSTING_RULE_SOURCE_UNIQUE = 'posting_rules_default_account_posting_rules_source_unique'
export const POSTING_RULES_SETTINGS_SCOPE_UNIQUE = 'posting_rules_settings_scope_unique'
