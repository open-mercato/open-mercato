/**
 * #7502: `mergeIdFilter` deliberately produces `{ $in: [] }` for a `?ids=` param
 * that left no valid UUID (or a disjoint `?id=`+`?ids=` intersection) — the
 * correct "match nothing" semantics. Both engine where-builders used to pass
 * that empty array straight to Kysely's `.where(column, 'in', [])`, which
 * compiles to invalid SQL (`in ()`) and makes Postgres answer 42601/500
 * instead of an empty page. These tests pin the guard directly on the two
 * private builder methods — no real SQL execution needed to prove the shape
 * changed; `count-cap-plan.test.ts`-style Postgres-gated tests cover the
 * end-to-end compiled-SQL behavior.
 */
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely'
import { BasicQueryEngine } from '../engine'

describe('applyColumnOp empty $in/$nin guard (#7502)', () => {
  const engine = new BasicQueryEngine({} as any, () => ({}) as any)

  function callApplyColumnOp(op: string, value: unknown) {
    const calls: any[] = []
    const builder: any = {
      where: (...args: any[]) => {
        calls.push(args)
        return builder
      },
    }
    ;(engine as any).applyColumnOp(builder, 'id', op, value)
    return calls
  }

  test('empty $in does not reach Kysely as an empty in-list', () => {
    const calls = callApplyColumnOp('in', [])
    expect(calls).toHaveLength(1)
    // Pre-fix this called builder.where('id', 'in', []) -- three arguments, the
    // shape Kysely compiles to invalid SQL. Post-fix it is a single predicate arg.
    expect(calls[0]).not.toEqual(['id', 'in', []])
    expect(calls[0]).toHaveLength(1)
  })

  test('non-empty $in keeps the original in-list predicate', () => {
    const calls = callApplyColumnOp('in', ['a'])
    expect(calls[0]).toEqual(['id', 'in', ['a']])
  })

  test('empty $nin does not reach Kysely as an empty not-in-list', () => {
    const calls = callApplyColumnOp('nin', [])
    expect(calls[0]).toHaveLength(1)
    expect(calls[0]).not.toEqual(['id', 'not in', []])
  })

  test('non-empty $nin keeps the original not-in-list predicate', () => {
    const calls = callApplyColumnOp('nin', ['a'])
    expect(calls[0]).toEqual(['id', 'not in', ['a']])
  })
})

describe('buildColumnOpExpression empty $in/$nin guard (#7502, OR-group path)', () => {
  const engine = new BasicQueryEngine({} as any, () => ({}) as any)

  function callBuildColumnOpExpression(op: string, value: unknown) {
    const eb: any = (...args: any[]) => ({ kind: 'cmp', args })
    eb.val = (v: any) => ({ kind: 'val', value: v })
    return (engine as any).buildColumnOpExpression(eb, 'id', op, value)
  }

  test('empty $in compiles to a never-match literal, not an empty in-list comparison', () => {
    expect(callBuildColumnOpExpression('in', [])).toEqual({ kind: 'val', value: false })
  })

  test('non-empty $in keeps the original in-list comparison', () => {
    expect(callBuildColumnOpExpression('in', ['a'])).toEqual({ kind: 'cmp', args: ['id', 'in', ['a']] })
  })

  test('empty $nin compiles to an always-match literal, not an empty not-in-list comparison', () => {
    expect(callBuildColumnOpExpression('nin', [])).toEqual({ kind: 'val', value: true })
  })

  test('non-empty $nin keeps the original not-in-list comparison', () => {
    expect(callBuildColumnOpExpression('nin', ['a'])).toEqual({ kind: 'cmp', args: ['id', 'not in', ['a']] })
  })
})

/**
 * #7637: #7502 guarded only the base-column builders. The custom-field EXISTS
 * builder (count shape / OR groups) and the entity_indexes doc builder still
 * spliced the list into `in (${sql.join(...)})`, which compiles to `in ()` for
 * an empty array. Compiled against a dummy Postgres dialect so the emitted SQL
 * itself is asserted.
 */
describe('custom-field and index-doc empty $in/$nin guard (#7637)', () => {
  const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
  } })
  const engine = new BasicQueryEngine({} as any, () => database as any) as any
  const base = () => database.selectFrom('customers as base').select('base.id')
  const cfSource = {
    entityId: 'customers:customer_entity',
    alias: 'base',
    table: 'customers',
    recordIdExpr: sql<string>`("base"."id")::text`,
  }

  const compileCf = (op: string, value: unknown) =>
    base().where((eb) => engine.buildCfValueExistsExpression(eb, {
      source: cfSource, qualify: (column: string) => `base.${column}`, tenantId: 'tenant-1', key: 'priority', op, value,
    })).compile()
  const compileDoc = (op: string, value: unknown) =>
    base().where((eb) => engine.buildIndexDocOpExpression(eb, {
      entity: 'customers:customer_entity', field: 'status', op, value, recordIdColumn: 'base.id',
      tenantId: 'tenant-1', organizationScope: null, withDeleted: false,
    })).compile()

  test.each([
    ['custom-field EXISTS', compileCf],
    ['index doc', compileDoc],
  ])('%s: empty $in compiles to a never-match predicate', (_label, compile) => {
    const query = compile('in', [])
    expect(query.sql).not.toMatch(/in \(\s*\)/)
    expect(query.sql).toMatch(/where false$/)
  })

  test.each([
    ['custom-field EXISTS', compileCf],
    ['index doc', compileDoc],
  ])('%s: empty $nin compiles to an always-match predicate', (_label, compile) => {
    const query = compile('nin', [])
    expect(query.sql).not.toMatch(/in \(\s*\)/)
    expect(query.sql).toMatch(/where true$/)
  })

  test.each([
    ['custom-field EXISTS', compileCf],
    ['index doc', compileDoc],
  ])('%s: non-empty lists keep their in-list predicates', (_label, compile) => {
    const inQuery = compile('in', ['a', 'b'])
    expect(inQuery.sql).toMatch(/ in \(\$\d+, \$\d+\)/)
    expect(inQuery.parameters).toEqual(expect.arrayContaining(['a', 'b']))
    const ninQuery = compile('nin', ['a'])
    expect(ninQuery.sql).toMatch(/ not in \(\$\d+\)|not exists \([\s\S]+ in \(\$\d+\)\)/)
  })
})
