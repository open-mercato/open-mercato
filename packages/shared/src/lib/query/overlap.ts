import { sql, type RawBuilder } from 'kysely'
import type { NormalizedFilter } from './join-utils'

const JSONB_COLUMN_VALUES = Symbol('jsonbColumnValues')

type JsonbColumnValues = { [JSONB_COLUMN_VALUES]: true; values: unknown }

function isJsonbColumnValues(value: unknown): value is JsonbColumnValues {
  return !!value && typeof value === 'object'
    && (value as Record<symbol, unknown>)[JSONB_COLUMN_VALUES] === true
}

export async function prepareOverlapFilters(
  filters: NormalizedFilter[],
  resolveColumnType: (field: string) => Promise<string | null>,
): Promise<void> {
  const columnTypes = new Map<string, string | null>()
  for (const filter of filters) {
    if ((filter.op !== 'overlap' && filter.op !== 'noverlap') || filter.field.startsWith('cf:')) continue
    if (!columnTypes.has(filter.field)) columnTypes.set(filter.field, await resolveColumnType(filter.field))
    if (columnTypes.get(filter.field) !== 'jsonb') continue
    const values = Array.isArray(filter.value) ? filter.value : [filter.value]
    if (values.some((value) => value !== null && value !== undefined && typeof value !== 'string')) {
      throw new TypeError('[internal] QueryEngine: JSONB overlap requires string values')
    }
    filter.value = { [JSONB_COLUMN_VALUES]: true, values: filter.value } satisfies JsonbColumnValues
  }
}

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
  if (isJsonbColumnValues(value)) return normalizeOverlapValues(value.values)
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
  const keyExpr = jsonbDocKeyExpression(docColumnRef, key)
  return sql<boolean>`(jsonb_typeof(${keyExpr}) = 'array' and ${keyExpr} ?| ${values}::text[])`
}

/**
 * jsonb "has none of" over a string-array key of an index document (`noverlap`):
 * `(jsonb_typeof(<expr>) = 'array' and not (<expr> ?| $n::text[]))`.
 *
 * Only a document whose key holds a JSON array can match: a missing key, a JSON `null` or a
 * scalar never satisfies it, so an unindexed document can never slip through an exclusion.
 * An empty value list excludes nothing (only the array check remains).
 */
export function buildJsonbNoOverlapPredicate(docColumnRef: string, key: string, value: unknown): RawBuilder<boolean> {
  const values = normalizeOverlapValues(value)
  const keyExpr = jsonbDocKeyExpression(docColumnRef, key)
  const isArray = sql<boolean>`jsonb_typeof(${keyExpr}) = 'array'`
  if (!values.length) return isArray
  return sql<boolean>`(${isArray} and not (${keyExpr} ?| ${values}::text[]))`
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
  return isJsonbColumnValues(value)
    ? sql<boolean>`(jsonb_typeof(${columnExpr}) = 'array' and ${columnExpr} ?| ${values}::text[])`
    : sql<boolean>`${columnExpr} && ${values}`
}

/**
 * Postgres array "has none of" for array-typed columns (`noverlap`): `not (<column> && $n)`.
 * A NULL column never matches; an empty value list excludes nothing (`<column> is not null`).
 */
export function buildArrayColumnNoOverlapPredicate(
  column: string | RawBuilder<unknown>,
  value: unknown,
): RawBuilder<boolean> {
  const values = normalizeOverlapValues(value)
  const columnExpr = typeof column === 'string' ? sql.ref(column) : column
  if (isJsonbColumnValues(value)) {
    const isArray = sql<boolean>`jsonb_typeof(${columnExpr}) = 'array'`
    return values.length ? sql<boolean>`(${isArray} and not (${columnExpr} ?| ${values}::text[]))` : isArray
  }
  if (!values.length) return sql<boolean>`${columnExpr} is not null`
  return sql<boolean>`not (${columnExpr} && ${values})`
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
