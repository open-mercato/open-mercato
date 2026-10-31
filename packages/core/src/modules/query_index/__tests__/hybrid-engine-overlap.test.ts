import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
  type RawBuilder,
  type SelectQueryBuilder,
} from 'kysely'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { makeMultiRuleTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { mergeAdvancedFilterTree } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine, clearBaseTableExistsCache } from '../lib/engine'

function makeCompilingDb(): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

type Builder = SelectQueryBuilder<any, any, any>
type IndexDocSource = { alias: string; entityId: string; recordIdColumn: string }

type HybridInternals = {
  applyIndexDocFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown, recordIdColumn: string) => Builder
  buildIndexDocFilterExpression: (eb: unknown, alias: string, entity: string, key: string, op: FilterOp, value: unknown, recordIdColumn: string) => RawBuilder<boolean>
  buildCfFilterExpression: (eb: unknown, key: string, op: FilterOp, value: unknown, sources: IndexDocSource[]) => RawBuilder<boolean> | null
  applyCfFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown) => Builder
  buildColumnFilterExpression: (eb: unknown, column: string, op: FilterOp, value: unknown) => RawBuilder<boolean>
  cfFilterHasPredicate: (op: FilterOp, value: unknown, sources: IndexDocSource[]) => boolean
}

const db = makeCompilingDb()
const em = { getKysely: () => db } as unknown as EntityManager
const engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db)) as unknown as HybridInternals
const ENTITY = 'catalog:catalog_product'
const sources: IndexDocSource[] = [{ alias: 'ei', entityId: ENTITY, recordIdColumn: 'b.id' }]

function base(): Builder {
  return db.selectFrom('catalog_products as b').leftJoin('entity_indexes as ei', 'ei.entity_id', 'b.id').select('b.id')
}

describe('HybridQueryEngine overlap', () => {
  it('compiles an index-document overlap to jsonb ?| against the literal key (GIN-matchable)', () => {
    const compiled = engine.applyIndexDocFilterFromAlias(base(), 'ei', ENTITY, 'scope_keys', 'overlap', ['cat:1', 'tag:2'], 'b.id').compile()
    expect(compiled.sql).toContain(`("ei"."doc" -> 'scope_keys') ?| $1::text[]`)
    expect(compiled.parameters).toEqual([['cat:1', 'tag:2']])
  })

  it('compiles the OR-group doc expression the same way', () => {
    const compiled = base()
      .where((eb) => eb.or([
        engine.buildIndexDocFilterExpression(eb, 'ei', ENTITY, 'scope_keys', 'overlap', ['cat:1'], 'b.id'),
        engine.buildColumnFilterExpression(eb, 'b.sku', 'eq', 'SKU-1'),
      ]))
      .compile()
    expect(compiled.sql).toContain(`("ei"."doc" -> 'scope_keys') ?| $1::text[] or "b"."sku" = $2`)
    expect(compiled.parameters).toEqual([['cat:1'], 'SKU-1'])
  })

  it('matches nothing for an empty overlap list', () => {
    const compiled = engine.applyIndexDocFilterFromAlias(base(), 'ei', ENTITY, 'scope_keys', 'overlap', [], 'b.id').compile()
    expect(compiled.sql).toMatch(/where false$/)
    expect(compiled.parameters).toEqual([])
  })

  it('compiles cf overlap with the multi-value containment semantics of `in`', () => {
    expect(engine.cfFilterHasPredicate('overlap', ['a'], sources)).toBe(true)
    const compiled = base()
      .where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', 'overlap', ['a', 'b'], sources)!)
      .compile()
    expect(compiled.sql).toContain('@> $')
    expect(compiled.sql.match(/ or /g)?.length).toBeGreaterThanOrEqual(3)
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', 'b', '["a"]', '["b"]']))
  })

  it('compiles an empty cf overlap to false on both cf paths', () => {
    const viaExpression = base()
      .where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', 'overlap', [], sources)!)
      .compile()
    expect(viaExpression.sql).toMatch(/where false$/)
    const viaAlias = engine.applyCfFilterFromAlias(base(), 'ei', ENTITY, 'cf:labels', 'overlap', []).compile()
    expect(viaAlias.sql).toMatch(/where false$/)
  })

  it('compiles base-column overlap to &&', () => {
    const compiled = base().where((eb) => engine.buildColumnFilterExpression(eb, 'b.tags', 'overlap', ['x'])).compile()
    expect(compiled.sql).toContain('"b"."tags" && $1')
    expect(compiled.parameters).toEqual([['x']])
  })

  it('leaves existing doc operators unchanged', () => {
    const compiled = engine.applyIndexDocFilterFromAlias(base(), 'ei', ENTITY, 'title', 'in', ['A', 'B'], 'b.id').compile()
    expect(compiled.sql).toContain(`("ei"."doc" ->> $1) in ($2, $3)`)
    expect(compiled.parameters).toEqual(['title', 'A', 'B'])
    expect(compiled.sql).not.toContain('?|')
  })

  it('compiles an index-document noverlap to a negated ?| that requires a present array', () => {
    const compiled = engine.applyIndexDocFilterFromAlias(base(), 'ei', ENTITY, 'scope_keys', 'noverlap', ['cat:1'], 'b.id').compile()
    expect(compiled.sql).toContain(
      `(jsonb_typeof(("ei"."doc" -> 'scope_keys')) = 'array' and not (("ei"."doc" -> 'scope_keys') ?| $1::text[]))`,
    )
    const grouped = base()
      .where((eb) => engine.buildIndexDocFilterExpression(eb, 'ei', ENTITY, 'scope_keys', 'noverlap', ['cat:1'], 'b.id'))
      .compile()
    expect(grouped.sql).toContain(`not (("ei"."doc" -> 'scope_keys') ?| $1::text[])`)
  })

  it('compiles base-column noverlap to not &&', () => {
    const compiled = base().where((eb) => engine.buildColumnFilterExpression(eb, 'b.tags', 'noverlap', ['x'])).compile()
    expect(compiled.sql).toContain('not ("b"."tags" && $1)')
  })

  it('compiles cf noverlap to false on both cf paths so it never widens a query', () => {
    expect(engine.cfFilterHasPredicate('noverlap', ['a'], sources)).toBe(true)
    const viaExpression = base()
      .where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', 'noverlap', ['a'], sources)!)
      .compile()
    expect(viaExpression.sql).toMatch(/where false$/)
    const viaAlias = engine.applyCfFilterFromAlias(base(), 'ei', ENTITY, 'cf:labels', 'noverlap', ['a']).compile()
    expect(viaAlias.sql).toMatch(/where false$/)
  })
})

function makeRecordingDb(columns: string[]): { db: Kysely<any>; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const rowsFor = (compiled: CompiledQuery): unknown[] => {
    if (compiled.sql.includes('"information_schema"."tables"')) return [{ one: 1 }]
    if (!compiled.sql.includes('"information_schema"."columns"')) return []
    if (compiled.parameters.length === 1) return columns.map((column) => ({ column_name: column, data_type: 'text' }))
    return columns.includes(String(compiled.parameters[1])) ? [{ one: 1 }] : []
  }
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiled)
      return { rows: rowsFor(compiled) as R[] }
    },
    async *streamQuery() {},
  }
  const recordingDb = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {},
        acquireConnection: async () => connection,
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
        destroy: async () => {},
      }),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db: recordingDb, queries }
}

describe('HybridQueryEngine tags OR filter', () => {
  beforeEach(() => {
    clearBaseTableExistsCache()
  })

  it.each([
    ['has all of first', ['has_all_of', 'has_any_of']],
    ['has any of first', ['has_any_of', 'has_all_of']],
  ] as const)('does not make the extra has all of tag mandatory when ORed with a has any of it implies (%s)', async (_order, operators) => {
    const values = { has_all_of: ['vip', 'eu'], has_any_of: ['vip'] }
    const tree = makeMultiRuleTree(
      operators.map((operator) => ({ field: 'tags', operator, value: values[operator] })),
      'or',
    )
    const { db: recordingDb, queries } = makeRecordingDb(['id', 'tenant_id', 'organization_id', 'deleted_at', 'tags'])
    const recordingEm = { getKysely: () => recordingDb } as unknown as EntityManager
    const fallback = new BasicQueryEngine(recordingEm, () => recordingDb)
    const fallbackSpy = jest.spyOn(fallback, 'query')
    const hybrid = new HybridQueryEngine(recordingEm, fallback)
    await hybrid.query(ENTITY, {
      tenantId: 'tenant-1',
      fields: ['id'],
      filters: mergeAdvancedFilterTree({}, tree),
    })
    expect(fallbackSpy).not.toHaveBeenCalled()
    const listQuery = queries.find((query) => /^select (?!count).* from "catalog_products" as "b"/.test(query.sql))
    expect(listQuery).toBeDefined()
    expect(listQuery!.sql.match(/"b"\."tags" && \$\d+/g)).toHaveLength(1)
    expect(listQuery!.sql).not.toMatch(/ or /)
    expect(listQuery!.parameters).toContainEqual(['vip'])
    expect(listQuery!.parameters).not.toContainEqual(['eu'])
  })
})
