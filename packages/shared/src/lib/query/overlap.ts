import { sql, type RawBuilder } from 'kysely'

const LITERAL_SAFE_DOC_KEY = /^[A-Za-z0-9_:.-]{1,128}$/

/**
 * Normalizes the right-hand side of an `overlap` filter into a de-duplicated list of strings.
 *
 * `null`/`undefined` entries are dropped; a scalar is treated as a one-element list. An empty
 * result means the filter matches nothing — every `overlap` builder compiles it to `false`
 * rather than dropping the predicate, so a caller that computes an empty inclusion set can
 * never widen a query by accident.
 */
export function normalizeOverlapValues(value: unknown): string[] {
  const list: readonly unknown[] = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value]
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (entry === undefined || entry === null) continue
    const normalized = String(entry)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/**
 * `(<docColumn> -> '<key>')` — the jsonb sub-document of an index document.
 *
 * The key is emitted as an escaped SQL literal when it is a plain identifier so the expression is
 * textually identical to a GIN expression index such as `((doc -> 'scope_keys'))` and the planner
 * can match it. Any other key falls back to a bound parameter (still correct, just not indexable).
 */
export function jsonbDocKeyExpression(docColumnRef: string, key: string): RawBuilder<unknown> {
  const keyExpr = LITERAL_SAFE_DOC_KEY.test(key) ? sql.lit(key) : sql`${key}`
  return sql`(${sql.ref(docColumnRef)} -> ${keyExpr})`
}

/**
 * jsonb "has any of" over a string-array key of an index document:
 * `(<docColumn> -> '<key>') ?| $n::text[]`. The values are bound as one array parameter.
 * A missing key or a JSON `null` evaluates to SQL NULL, i.e. the row does not match.
 */
export function buildJsonbOverlapPredicate(docColumnRef: string, key: string, value: unknown): RawBuilder<boolean> {
  const values = normalizeOverlapValues(value)
  if (!values.length) return sql<boolean>`false`
  return sql<boolean>`${jsonbDocKeyExpression(docColumnRef, key)} ?| ${values}::text[]`
}

/**
 * Postgres array overlap for array-typed columns: `<column> && $n`. The bound array takes its
 * element type from the column, so `text[]`, `varchar[]` and `uuid[]` columns all work.
 */
export function buildArrayColumnOverlapPredicate(
  column: string | RawBuilder<unknown>,
  value: unknown,
): RawBuilder<boolean> {
  const values = normalizeOverlapValues(value)
  if (!values.length) return sql<boolean>`false`
  const columnExpr = typeof column === 'string' ? sql.ref(column) : column
  return sql<boolean>`${columnExpr} && ${values}`
}

/**
 * `overlap` over a scalar expression evaluated once per stored value (custom-field value rows):
 * the record matches when any of its values is one of the requested ones — `<expr> in (...)`.
 */
export function buildScalarOverlapPredicate(expression: RawBuilder<unknown>, value: unknown): RawBuilder<boolean> {
  const values = normalizeOverlapValues(value)
  if (!values.length) return sql<boolean>`false`
  return sql<boolean>`${expression} in (${sql.join(values.map((entry) => sql`${entry}`), sql`, `)})`
}
