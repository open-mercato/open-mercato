import type { EntityManager } from '@mikro-orm/postgresql'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql, type RawBuilder } from 'kysely'
import { BasicQueryEngine } from '../engine'

const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
} })
const base = () => database.selectFrom('customers as base').select('base.id')
type Internals = {
  buildCfValueExistsExpression: (eb: unknown, options: {
    source: { entityId: string; alias: string; table: string; recordIdExpr: RawBuilder<string> }
    qualify: (column: string) => string; tenantId: string; key: string; op: string; value: unknown
  }) => RawBuilder<boolean>
}
const engine = new BasicQueryEngine({} as EntityManager, () => database) as unknown as Internals
const source = { entityId: 'customers:customer_entity', alias: 'base', table: 'customers', recordIdExpr: sql<string>`${sql.ref('base.id')}::text` }

function compile(op: string, value: unknown) {
  return base().where((eb) => engine.buildCfValueExistsExpression(eb, {
    source, qualify: (column) => `base.${column}`, tenantId: 'tenant-1', key: 'labels', op, value,
  })).compile()
}

describe('BasicQueryEngine cf ne/nin on multi-value fields (#10168)', () => {
  test('ne requires a set value and no value row equal to the excluded one', () => {
    const compiled = compile('ne', 'a')
    expect(compiled.sql).toMatch(/where \(exists \(select[\s\S]+ is not null\) and not exists \(select[\s\S]+ in \(\$\d+\)\)\)$/)
    expect(compiled.sql).not.toContain('!=')
    expect(compiled.sql).not.toContain('not in')
    expect(compiled.parameters).toContain('a')
  })

  test('nin requires a set value and no value row equal to any excluded value', () => {
    const compiled = compile('nin', ['a', 'b'])
    expect(compiled.sql).toMatch(/where \(exists \(select[\s\S]+ is not null\) and not exists \(select[\s\S]+ in \(\$\d+, \$\d+\)\)\)$/)
    expect(compiled.sql).not.toContain('not in')
    expect(compiled.parameters).toEqual(expect.arrayContaining(['a', 'b']))
  })

  test('both value-row subqueries stay correlated to the record and scoped to the tenant', () => {
    const compiled = compile('ne', 'a')
    expect(compiled.sql.match(/"cfev_\d+"\."record_id" = "base"\."id"::text/g)).toHaveLength(2)
    expect(compiled.parameters.filter((parameter) => parameter === 'tenant-1')).toHaveLength(4)
    expect(compiled.parameters.filter((parameter) => parameter === 'labels')).toHaveLength(4)
  })

  test('ne null still means the field is set', () => {
    const compiled = compile('ne', null)
    expect(compiled.sql).toMatch(/where exists \(select[\s\S]+ is not null\)$/)
    expect(compiled.sql).not.toContain('not exists')
  })

  test('an empty nin still excludes nothing', () => {
    const compiled = compile('nin', [])
    expect(compiled.sql).toMatch(/where true$/)
  })
})
