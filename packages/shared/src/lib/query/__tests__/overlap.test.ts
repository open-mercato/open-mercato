import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
  type RawBuilder,
} from 'kysely'
import { BasicQueryEngine, clearColumnExistsCache } from '../engine'
import { normalizeFilters } from '../join-utils'
import { makeMultiRuleTree } from '../advanced-filter-tree'
import { mergeAdvancedFilterTree } from '../../crud/advanced-filter-integration'
import {
  buildArrayColumnNoOverlapPredicate,
  buildArrayColumnOverlapPredicate,
  buildJsonbNoOverlapPredicate,
  buildJsonbOverlapPredicate,
  buildScalarOverlapPredicate,
  jsonbDocKeyExpression,
  normalizeOverlapValues,
} from '../overlap'
import type { FilterOp } from '../types'

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

const db = makeCompilingDb()

function compileWhere(predicate: RawBuilder<boolean>): { sql: string; parameters: readonly unknown[] } {
  const compiled = db.selectFrom('entity_indexes as ei').select('ei.id').where(predicate).compile()
  return { sql: compiled.sql, parameters: compiled.parameters }
}

type EngineInternals = {
  applyColumnOp: (builder: unknown, column: string, op: string, value: unknown) => { compile: () => { sql: string; parameters: readonly unknown[] } }
  buildColumnOpExpression: (eb: unknown, column: string, op: string, value: unknown) => RawBuilder<boolean>
  buildIndexDocOpExpression: (eb: unknown, opts: {
    entity: string
    field: string
    op: FilterOp
    value: unknown
    recordIdColumn: string
    tenantId?: string | null
    withDeleted: boolean
  }) => RawBuilder<boolean>
}

const engine = new BasicQueryEngine({} as EntityManager, () => db) as unknown as EngineInternals

describe('normalizeOverlapValues', () => {
  it('flattens, stringifies, drops nullish and de-duplicates', () => {
    expect(normalizeOverlapValues(['a', 'b', 'a', null, undefined, 3])).toEqual(['a', 'b', '3'])
    expect(normalizeOverlapValues('a')).toEqual(['a'])
    expect(normalizeOverlapValues(undefined)).toEqual([])
    expect(normalizeOverlapValues(null)).toEqual([])
  })
})

describe('overlap predicate builders', () => {
  it('compiles a jsonb has-any-of with the values bound as one array parameter', () => {
    const compiled = compileWhere(buildJsonbOverlapPredicate('ei.doc', 'scope_keys', ['cat:1', 'tag:2']))
    expect(compiled.sql).toContain(`("ei"."doc" -> 'scope_keys') ?| $1::text[]`)
    expect(compiled.parameters).toEqual([['cat:1', 'tag:2']])
  })

  it('never interpolates values into the SQL text', () => {
    const hostile = "x'); drop table entity_indexes; --"
    const compiled = compileWhere(buildJsonbOverlapPredicate('ei.doc', 'scope_keys', [hostile]))
    expect(compiled.sql).not.toContain('drop table')
    expect(compiled.parameters).toEqual([[hostile]])
  })

  it('binds a key that is not a plain identifier instead of inlining it', () => {
    const key = "scope'keys"
    const expression = db.selectFrom('entity_indexes as ei').select(jsonbDocKeyExpression('ei.doc', key).as('value')).compile()
    expect(expression.sql).toContain('("ei"."doc" -> $1)')
    expect(expression.parameters).toEqual([key])
  })

  it.each([
    ['jsonb', () => buildJsonbOverlapPredicate('ei.doc', 'scope_keys', [])],
    ['array column', () => buildArrayColumnOverlapPredicate('ei.tags', [])],
    ['scalar', () => buildScalarOverlapPredicate(sql`ei.value`, [null, undefined])],
  ])('compiles an empty %s value list to false (matches nothing)', (_label, build) => {
    const compiled = compileWhere(build())
    expect(compiled.sql).toMatch(/where false$/)
    expect(compiled.parameters).toEqual([])
  })

  it('compiles array-column overlap to && with a bound array', () => {
    const compiled = compileWhere(buildArrayColumnOverlapPredicate('ei.tags', ['a', 'b']))
    expect(compiled.sql).toContain('"ei"."tags" && $1')
    expect(compiled.parameters).toEqual([['a', 'b']])
  })

  it('compiles scalar overlap to an IN list of bound values', () => {
    const compiled = compileWhere(buildScalarOverlapPredicate(sql`ei.value`, ['a', 'b']))
    expect(compiled.sql).toContain('ei.value in ($1, $2)')
    expect(compiled.parameters).toEqual(['a', 'b'])
  })
})

describe('BasicQueryEngine overlap', () => {
  it('normalizes $overlap from the object filter syntax', () => {
    const filters = normalizeFilters({ scope_keys: { $overlap: ['cat:1'] } })
    expect(filters).toEqual([expect.objectContaining({ field: 'scope_keys', op: 'overlap', value: ['cat:1'] })])
  })

  it('applies && on a base column', () => {
    const builder = db.selectFrom('catalog_products as b').select('b.id')
    const compiled = engine.applyColumnOp(builder, 'b.tags', 'overlap', ['x', 'y']).compile()
    expect(compiled.sql).toContain('"b"."tags" && $1')
    expect(compiled.parameters).toEqual([['x', 'y']])
  })

  it('compiles an index-document overlap inside the entity_indexes EXISTS', () => {
    const compiled = db
      .selectFrom('catalog_products as b')
      .select('b.id')
      .where((eb) => engine.buildIndexDocOpExpression(eb, {
        entity: 'catalog:catalog_product',
        field: 'scope_keys',
        op: 'overlap',
        value: ['cat:1'],
        recordIdColumn: 'b.id',
        tenantId: 'tenant-1',
        withDeleted: false,
      }))
      .compile()
    expect(compiled.sql).toMatch(/exists \(select 1 as "one" from "entity_indexes" as "ei_\d+"/)
    expect(compiled.sql).toMatch(/\("ei_\d+"\."doc" -> 'scope_keys'\) \?\| \$\d+::text\[\]/)
    expect(compiled.parameters).toContainEqual(['cat:1'])
  })

  it('leaves existing operators unchanged', () => {
    const compiled = db
      .selectFrom('catalog_products as b')
      .select('b.id')
      .where((eb) => eb.and([
        engine.buildColumnOpExpression(eb, 'b.sku', 'in', ['a', 'b']),
        engine.buildColumnOpExpression(eb, 'b.title', 'ilike', '%x%'),
        engine.buildColumnOpExpression(eb, 'b.deleted_at', 'exists', false),
      ]))
      .compile()
    expect(compiled.sql).toContain('"b"."sku" in ($1, $2)')
    expect(compiled.sql).toContain('"b"."title" ilike $3')
    expect(compiled.sql).toContain('"b"."deleted_at" is null')
    expect(compiled.sql).not.toContain('&&')
    expect(compiled.sql).not.toContain('?|')
  })
})

describe('noverlap predicate builders', () => {
  it('compiles a jsonb has-none-of that requires a present array', () => {
    const compiled = compileWhere(buildJsonbNoOverlapPredicate('ei.doc', 'scope_keys', ['cat:1', 'tag:2']))
    expect(compiled.sql).toContain(
      `(jsonb_typeof(("ei"."doc" -> 'scope_keys')) = 'array' and not (("ei"."doc" -> 'scope_keys') ?| $1::text[]))`,
    )
    expect(compiled.parameters).toEqual([['cat:1', 'tag:2']])
  })

  it('keeps only the array check for an empty jsonb value list', () => {
    const compiled = compileWhere(buildJsonbNoOverlapPredicate('ei.doc', 'scope_keys', []))
    expect(compiled.sql).toMatch(/where jsonb_typeof\(\("ei"\."doc" -> 'scope_keys'\)\) = 'array'$/)
    expect(compiled.parameters).toEqual([])
  })

  it('compiles array-column has-none-of to not && and an empty list to is not null', () => {
    const compiled = compileWhere(buildArrayColumnNoOverlapPredicate('ei.tags', ['a']))
    expect(compiled.sql).toContain('not ("ei"."tags" && $1)')
    expect(compiled.parameters).toEqual([['a']])
    expect(compileWhere(buildArrayColumnNoOverlapPredicate('ei.tags', [])).sql).toContain('"ei"."tags" is not null')
  })
})

describe('BasicQueryEngine noverlap', () => {
  it('normalizes $noverlap from the object filter syntax', () => {
    const filters = normalizeFilters({ scope_keys: { $noverlap: ['cat:1'] } })
    expect(filters).toEqual([expect.objectContaining({ field: 'scope_keys', op: 'noverlap', value: ['cat:1'] })])
  })

  it('compiles an index-document noverlap inside the entity_indexes EXISTS', () => {
    const compiled = db
      .selectFrom('catalog_products as b')
      .select('b.id')
      .where((eb) => engine.buildIndexDocOpExpression(eb, {
        entity: 'catalog:catalog_product',
        field: 'scope_keys',
        op: 'noverlap',
        value: ['cat:1'],
        recordIdColumn: 'b.id',
        tenantId: 'tenant-1',
        withDeleted: false,
      }))
      .compile()
    expect(compiled.sql).toMatch(/exists \(select 1 as "one" from "entity_indexes" as "ei_\d+"/)
    expect(compiled.sql).toMatch(/not \(\("ei_\d+"\."doc" -> 'scope_keys'\) \?\| \$\d+::text\[\]\)/)
  })

  it('applies not && on a base column', () => {
    const builder = db.selectFrom('catalog_products as b').select('b.id')
    const compiled = engine.applyColumnOp(builder, 'b.tags', 'noverlap', ['x']).compile()
    expect(compiled.sql).toContain('not ("b"."tags" && $1)')
    const expression = db
      .selectFrom('catalog_products as b')
      .select('b.id')
      .where((eb) => engine.buildColumnOpExpression(eb, 'b.tags', 'noverlap', ['x']))
      .compile()
    expect(expression.sql).toContain('not ("b"."tags" && $1)')
  })
})

function makeRecordingDb(columns: string[]): { db: Kysely<any>; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiled)
      const isKnownColumn = compiled.sql.includes('"information_schema"."columns"') && columns.includes(String(compiled.parameters[1]))
      return { rows: (isKnownColumn ? [{ one: 1 }] : []) as R[] }
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

describe('BasicQueryEngine tags OR filter', () => {
  beforeEach(() => {
    clearColumnExistsCache()
  })

  const storages = [
    ['an array column', ['id', 'tenant_id', 'deleted_at', 'tags'], /"catalog_products"\."tags" && \$\d+/g],
    ['an index document', ['id', 'tenant_id', 'deleted_at'], /\("ei_\d+"\."doc" -> 'tags'\) \?\| \$\d+::text\[\]/g],
  ] as const
  const orders = [
    ['has all of first', ['has_all_of', 'has_any_of']],
    ['has any of first', ['has_any_of', 'has_all_of']],
  ] as const

  describe.each(storages)('stored in %s', (_storage, columns, tagPredicate) => {
    it.each(orders)('does not make the extra has all of tag mandatory when ORed with a has any of it implies (%s)', async (_order, operators) => {
      const values = { has_all_of: ['vip', 'eu'], has_any_of: ['vip'] }
      const tree = makeMultiRuleTree(
        operators.map((operator) => ({ field: 'tags', operator, value: values[operator] })),
        'or',
      )
      const { db: recordingDb, queries } = makeRecordingDb([...columns])
      const recordingEngine = new BasicQueryEngine({} as EntityManager, () => recordingDb)
      await recordingEngine.query('catalog:catalog_product', {
        tenantId: 'tenant-1',
        fields: ['id'],
        filters: mergeAdvancedFilterTree({}, tree),
      })
      const listQuery = queries.find((query) => query.sql.startsWith('select "catalog_products"."id"'))
      expect(listQuery).toBeDefined()
      expect(listQuery!.sql.match(tagPredicate)).toHaveLength(1)
      expect(listQuery!.sql).not.toContain(' or ')
      expect(listQuery!.parameters).toContainEqual(['vip'])
      expect(listQuery!.parameters).not.toContainEqual(['eu'])
    })
  })
})
