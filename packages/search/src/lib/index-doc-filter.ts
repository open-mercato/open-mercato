import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type RawBuilder,
} from 'kysely'
import type { SearchIndexDocCondition, SearchIndexDocFilter } from '@open-mercato/shared/modules/search'
import {
  buildJsonbNoOverlapPredicate,
  buildJsonbOverlapPredicate,
  jsonbDocKeyExpression,
  normalizeOverlapValues,
} from '@open-mercato/shared/lib/query/overlap'

/**
 * `SearchOptions.indexDocFilter` compiled to one correlated `exists` over `entity_indexes`, so a
 * strategy can AND it into the query that ranks — the predicate decides which rows are ranked,
 * never which ranked rows are kept, and a restrictive filter cannot starve the result set (except
 * under a pgvector `ivfflat` index scan, which applies it to the probed lists' candidates only).
 */

export const INDEX_DOC_FILTER_ALIAS = 'om_index_doc'

export type IndexDocFilterTarget = {
  /** Column of the ranked table holding the entity type (`module:entity`). */
  entityTypeRef: string
  /** Column of the ranked table holding the record id. */
  recordIdRef: string
  /** Column of the ranked table holding the tenant id. */
  tenantIdRef: string
}

const DOC_REF = `${INDEX_DOC_FILTER_ALIAS}.doc`

function conditionPredicate(condition: SearchIndexDocCondition): RawBuilder<boolean> {
  switch (condition.op) {
    case 'exists': {
      const keyExpr = jsonbDocKeyExpression(DOC_REF, condition.key)
      return sql<boolean>`(jsonb_typeof(${keyExpr}) is not null and jsonb_typeof(${keyExpr}) <> 'null')`
    }
    case 'eq':
      return sql<boolean>`(${jsonbDocKeyExpression(DOC_REF, condition.key)} #>> '{}') = ${String(condition.value)}`
    case 'overlap':
      return buildJsonbOverlapPredicate(DOC_REF, condition.key, condition.values)
    case 'noverlap':
      return buildJsonbNoOverlapPredicate(DOC_REF, condition.key, condition.values)
    case 'recordIdNotIn': {
      const values = normalizeOverlapValues(condition.values)
      if (!values.length) return sql<boolean>`true`
      return sql<boolean>`not (${sql.ref(`${INDEX_DOC_FILTER_ALIAS}.entity_id`)} = any(${values}::text[]))`
    }
  }
}

function branchPredicate(branch: SearchIndexDocCondition[]): RawBuilder<boolean> {
  if (!branch.length) return sql<boolean>`true`
  return sql<boolean>`(${sql.join(branch.map(conditionPredicate), sql` and `)})`
}

/** The filter's DNF over the `entity_indexes` row aliased `INDEX_DOC_FILTER_ALIAS`. */
export function buildIndexDocFilterPredicate(filter: SearchIndexDocFilter): RawBuilder<boolean> {
  if (!filter.anyOf.length) return sql<boolean>`false`
  return sql<boolean>`(${sql.join(filter.anyOf.map(branchPredicate), sql` or `)})`
}

/**
 * `exists (select 1 from entity_indexes … )` correlated to the ranked row by entity type, record id
 * and tenant, restricted to live index rows and to the filter's DNF.
 */
export function buildIndexDocFilterExists(filter: SearchIndexDocFilter, target: IndexDocFilterTarget): RawBuilder<boolean> {
  const alias = (column: string) => sql.ref(`${INDEX_DOC_FILTER_ALIAS}.${column}`)
  return sql<boolean>`exists (select 1 from entity_indexes as ${sql.id(INDEX_DOC_FILTER_ALIAS)} where ${alias('entity_type')} = ${sql.ref(target.entityTypeRef)} and ${alias('entity_id')} = (${sql.ref(target.recordIdRef)})::text and ${alias('tenant_id')} = ${sql.ref(target.tenantIdRef)} and ${alias('deleted_at')} is null and ${buildIndexDocFilterPredicate(filter)})`
}

let compileOnlyDb: Kysely<Record<string, never>> | null = null

function compiler(): Kysely<Record<string, never>> {
  if (!compileOnlyDb) {
    compileOnlyDb = new Kysely<Record<string, never>>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    })
  }
  return compileOnlyDb
}

/**
 * The `exists` clause as Postgres text for drivers that issue raw SQL: placeholders start at
 * `$<firstParameterIndex>` so the caller appends `parameters` after its own.
 */
export function compileIndexDocFilterExists(
  filter: SearchIndexDocFilter,
  target: IndexDocFilterTarget,
  firstParameterIndex: number,
): { sql: string; parameters: unknown[] } {
  const compiled = buildIndexDocFilterExists(filter, target).compile(compiler())
  const offset = firstParameterIndex - 1
  return {
    sql: compiled.sql.replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + offset}`),
    parameters: [...compiled.parameters],
  }
}
