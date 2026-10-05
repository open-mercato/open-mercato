import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type RawBuilder,
} from 'kysely'
import { BasicQueryEngine } from '../engine'
import { normalizeFilters } from '../join-utils'
import {
  buildArrayColumnOverlapPredicate,
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
