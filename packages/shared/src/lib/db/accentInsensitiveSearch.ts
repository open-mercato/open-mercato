/**
 * SQL text for accent-insensitive `ILIKE` matching in PostgreSQL.
 *
 * A query predicate and the expression index backing it must be spelled
 * identically or the planner silently ignores the index, so both sides build
 * their SQL from the helpers here instead of repeating the literal. These are
 * pure string builders — they assume nothing about which migration installed
 * the function, only that both sides agree on its name.
 *
 * The function itself is created by a migration (currently
 * `packages/core/src/modules/catalog/migrations/`); promote that migration to a
 * platform-level one when a second module needs the same matching.
 */

/**
 * Schema-qualified name of the IMMUTABLE `unaccent()` wrapper the expressions
 * below call.
 *
 * PostgreSQL's built-in `unaccent()` is STABLE, because the single-argument form
 * resolves its text-search dictionary through `search_path`, and a STABLE
 * function cannot appear in an index expression. The wrapper pins the dictionary
 * with `'public.unaccent'::regdictionary` so it is genuinely immutable rather
 * than merely declared so — but the wrapper's own *call site* is still resolved
 * through `search_path` unless it is schema-qualified too, so both the index
 * expression and the runtime query predicate reference `public.` explicitly
 * rather than relying on the caller's `search_path` containing it.
 */
export const IMMUTABLE_UNACCENT_FUNCTION = 'public.om_immutable_unaccent'

/** DDL creating the wrapper. Kept here so the migration and the query agree. */
export const buildImmutableUnaccentFunctionSql = (): string =>
  `create or replace function ${IMMUTABLE_UNACCENT_FUNCTION}(text)
returns text as $$
  select public.unaccent('public.unaccent'::regdictionary, $1)
$$ language sql immutable parallel safe strict;`

/**
 * `unaccent`ed concatenation of `columns`, NULL-safe and space-separated.
 *
 * Column names are quoted but not table-qualified: the caller's query must
 * reference a single table, which is also what the index expression sees.
 */
export const buildAccentInsensitiveSearchExpression = (columns: readonly string[]): string => {
  if (!columns.length) throw new Error('[internal] buildAccentInsensitiveSearchExpression requires at least one column')
  const concatenated = columns.map((column) => `coalesce("${column}", '')`).join(` || ' ' || `)
  return `${IMMUTABLE_UNACCENT_FUNCTION}(${concatenated})`
}

/** Right-hand side of the comparison: the bound pattern, unaccented the same way. */
export const buildAccentInsensitivePatternSql = (): string => `${IMMUTABLE_UNACCENT_FUNCTION}(?)`
