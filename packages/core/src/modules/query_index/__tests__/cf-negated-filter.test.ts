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
type AliasDb = { ce: IndexDb['entity_indexes'] }
type AliasBuilder = SelectQueryBuilder<AliasDb, 'ce', { id: string }>
type IndexDocSource = { alias: string; entityId: string; recordIdColumn: string }

type HybridInternals = {
  buildCfFilterExpression: (
    eb: ExpressionBuilder<IndexDb, 'ei'>,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
  ) => Expression<boolean> | null
  applyCfFilterFromAlias: (
    builder: AliasBuilder,
    alias: string,
    entityType: string,
    key: string,
    op: FilterOp,
    value: unknown,
  ) => AliasBuilder
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
const sources: IndexDocSource[] = [{ alias: 'ei', entityId: 'catalog:catalog_product', recordIdColumn: 'ei.id' }]

function compile(op: FilterOp, value: unknown) {
  return db
    .selectFrom('entity_indexes as ei')
    .select('ei.id')
    .where((eb) => engine.buildCfFilterExpression(eb, 'cf:labels', op, value, sources)!)
    .compile()
}

describe('HybridQueryEngine.buildCfFilterExpression ne/nin on multi-value fields', () => {
  it('compiles ne as the negation of the containment-aware eq', () => {
    const compiled = compile('ne', 'a')
    expect(compiled.sql).toMatch(/where not \(.+ = \$\d+ or .+ @> \$\d+::jsonb\)$/)
    expect(compiled.sql).not.toContain('<>')
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', '["a"]']))
  })

  it('compiles nin as the negation of the containment-aware in', () => {
    const compiled = compile('nin', ['a', 'b'])
    expect(compiled.sql).toMatch(/where not \(.+ = \$\d+ or .+ @> \$\d+::jsonb or .+ = \$\d+ or .+ @> \$\d+::jsonb\)$/)
    expect(compiled.sql).not.toContain('not in')
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', '["a"]', 'b', '["b"]']))
  })

  it('keeps ne null as is not null', () => {
    const compiled = compile('ne', null)
    expect(compiled.sql).toMatch(/where coalesce\(.+\) is not null$/)
    expect(compiled.sql).not.toContain('@>')
  })

  it('compiles an empty nin to the field being set', () => {
    const compiled = compile('nin', [])
    expect(compiled.sql).toMatch(/where coalesce\(.+\) is not null$/)
    expect(compiled.sql).not.toContain('not in')
  })
})

describe('HybridQueryEngine.applyCfFilterFromAlias on multi-value fields (#10167)', () => {
  function compileAlias(op: FilterOp, value: unknown) {
    const base = db
      .selectFrom('entity_indexes as ce')
      .select('ce.id') as unknown as AliasBuilder
    return engine.applyCfFilterFromAlias(base, 'ce', 'user:widget', 'cf:labels', op, value).compile()
  }

  const containment = /coalesce\("ce"\."doc" -> (\$\d+), "ce"\."doc" -> (\$\d+)\) @> \$\d+::jsonb/

  it.each<[FilterOp, unknown]>([
    ['eq', 'a'], ['in', ['a']], ['overlap', ['a']], ['ne', 'a'], ['nin', ['a']],
  ])('reads the array for %s from the cf: key or the bare key', (op, value) => {
    const compiled = compileAlias(op, value)
    const placeholders = containment.exec(compiled.sql)?.slice(1) ?? []
    const keys = placeholders.map((placeholder) => compiled.parameters[Number(placeholder.slice(1)) - 1])
    expect(keys).toEqual(['cf:labels', 'labels'])
    expect(compiled.parameters).toContain('["a"]')
  })

  it.each<[FilterOp, FilterOp, unknown]>([
    ['ne', 'eq', 'a'], ['nin', 'in', ['a', 'b']],
  ])('compiles %s as the negation of the containment-aware %s', (negated, positive, value) => {
    const predicate = (op: FilterOp) => compileAlias(op, value).sql.split(' where ')[1]
    expect(predicate(negated)).toBe(`not ${predicate(positive)}`)
  })

  it('keeps ne null as is not null and an empty nin as match-all', () => {
    expect(compileAlias('ne', null).sql).toMatch(/where coalesce\(.+\) is not null$/)
    expect(compileAlias('nin', []).sql).toMatch(/where true$/)
  })
})
