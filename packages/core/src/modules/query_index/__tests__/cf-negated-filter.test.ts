import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Expression,
  type ExpressionBuilder,
  type SelectQueryBuilder,
} from 'kysely'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { FilterOp } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine } from '../lib/engine'

type IndexDb = { entity_indexes: { id: string; doc: unknown } }
type Builder = SelectQueryBuilder<IndexDb, 'ei', { id: string }>
type IndexDocSource = { alias: string; entityId: string; recordIdColumn: string }

type HybridInternals = {
  buildCfFilterExpression: (
    eb: ExpressionBuilder<IndexDb, 'ei'>,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
  ) => Expression<boolean> | null
  applyCfFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown) => Builder
}

const db = new Kysely<IndexDb>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (introspected) => new PostgresIntrospector(introspected),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})
const em = { getKysely: () => db } as unknown as EntityManager
const engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db)) as unknown as HybridInternals
const ENTITY = 'catalog:catalog_product'
const sources: IndexDocSource[] = [{ alias: 'ei', entityId: ENTITY, recordIdColumn: 'ei.id' }]

function base(): Builder {
  return db.selectFrom('entity_indexes as ei').select('ei.id')
}

function viaExpression(op: FilterOp, value: unknown) {
  return base().where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', op, value, sources)!).compile()
}

function viaAlias(op: FilterOp, value: unknown) {
  return engine.applyCfFilterFromAlias(base(), 'ei', ENTITY, 'cf:labels', op, value).compile()
}

describe('HybridQueryEngine cf ne/nin on multi-value fields', () => {
  it.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s compiles ne as the negation of the containment-aware eq', (_name, compile) => {
    const compiled = compile('ne', 'a')
    expect(compiled.sql).toMatch(/where not \(.+ = \$\d+ or .+ @> \$\d+::jsonb\)$/)
    expect(compiled.sql).not.toContain('<>')
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', '["a"]']))
  })

  it.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s compiles nin as the negation of the containment-aware in', (_name, compile) => {
    const compiled = compile('nin', ['a', 'b'])
    expect(compiled.sql).toMatch(/where not \(.+ = \$\d+ or .+ @> \$\d+::jsonb or .+ = \$\d+ or .+ @> \$\d+::jsonb\)$/)
    expect(compiled.sql).not.toContain('not in')
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', '["a"]', 'b', '["b"]']))
  })

  it.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s keeps ne null as is not null', (_name, compile) => {
    const compiled = compile('ne', null)
    expect(compiled.sql).toMatch(/where coalesce\(.+\) is not null$/)
    expect(compiled.sql).not.toContain('@>')
  })

  it.each([
    ['buildCfFilterExpression', viaExpression],
    ['applyCfFilterFromAlias', viaAlias],
  ])('%s compiles an empty nin to the field being set', (_name, compile) => {
    const compiled = compile('nin', [])
    expect(compiled.sql).toMatch(/where coalesce\(.+\) is not null$/)
    expect(compiled.sql).not.toContain('not in')
  })
})
