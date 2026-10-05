import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
  type SelectQueryBuilder,
} from 'kysely'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

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
})
