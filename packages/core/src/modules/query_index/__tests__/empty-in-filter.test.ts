/**
 * #7502: see the matching test file in `@open-mercato/shared/lib/query/__tests__`
 * for the full context. `HybridQueryEngine` has the same two where-builders
 * (AND-path `applyColumnFilter`, OR-group-path `buildColumnFilterExpression`)
 * that used to pass an empty `$in`/`$nin` array straight to Kysely, compiling
 * to invalid SQL (`in ()`, 42601) instead of a predicate that matches nothing.
 */
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import { HybridQueryEngine } from '../lib/engine'

describe('applyColumnFilter empty $in/$nin guard (#7502)', () => {
  const engine = new HybridQueryEngine({} as any, {} as any)

  function callApplyColumnFilter(op: string, value: unknown) {
    const calls: any[] = []
    const builder: any = {
      where: (...args: any[]) => {
        calls.push(args)
        return builder
      },
    }
    ;(engine as any).applyColumnFilter(builder, 'id', { field: 'id', op, value })
    return calls
  }

  test('empty $in does not reach Kysely as an empty in-list', () => {
    const calls = callApplyColumnFilter('in', [])
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toEqual(['id', 'in', []])
    expect(calls[0]).toHaveLength(1)
  })

  test('non-empty $in keeps the original in-list predicate', () => {
    const calls = callApplyColumnFilter('in', ['a'])
    expect(calls[0]).toEqual(['id', 'in', ['a']])
  })

  test('empty $nin does not reach Kysely as an empty not-in-list', () => {
    const calls = callApplyColumnFilter('nin', [])
    expect(calls[0]).toHaveLength(1)
    expect(calls[0]).not.toEqual(['id', 'not in', []])
  })

  test('non-empty $nin keeps the original not-in-list predicate', () => {
    const calls = callApplyColumnFilter('nin', ['a'])
    expect(calls[0]).toEqual(['id', 'not in', ['a']])
  })
})

describe('buildColumnFilterExpression empty $in/$nin guard (#7502, OR-group path)', () => {
  const engine = new HybridQueryEngine({} as any, {} as any)

  function callBuildColumnFilterExpression(op: string, value: unknown) {
    const calls: any[] = []
    const eb: any = (...args: any[]) => {
      calls.push({ kind: 'cmp', args })
      return { kind: 'cmp', args }
    }
    const result = (engine as any).buildColumnFilterExpression(eb, 'id', op, value)
    return { calls, result }
  }

  test('empty $in compiles to a raw never-match predicate, not an empty in-list comparison', () => {
    const { calls, result } = callBuildColumnFilterExpression('in', [])
    expect(calls).toHaveLength(0)
    expect(result).toBeDefined()
  })

  test('non-empty $in keeps the original in-list comparison', () => {
    const { result } = callBuildColumnFilterExpression('in', ['a'])
    expect(result).toEqual({ kind: 'cmp', args: ['id', 'in', ['a']] })
  })

  test('empty $nin compiles to a raw always-match predicate, not an empty not-in-list comparison', () => {
    const { calls, result } = callBuildColumnFilterExpression('nin', [])
    expect(calls).toHaveLength(0)
    expect(result).toBeDefined()
  })

  test('non-empty $nin keeps the original not-in-list comparison', () => {
    const { result } = callBuildColumnFilterExpression('nin', ['a'])
    expect(result).toEqual({ kind: 'cmp', args: ['id', 'not in', ['a']] })
  })
})

/**
 * #7637: the join-column builder (`applyJoinColumnFilterOp`, used inside join
 * EXISTS subqueries) and the custom-field / JSON-doc builders still passed an
 * empty list through to `in ()`. Compiled against a dummy Postgres dialect so
 * the emitted SQL itself is asserted.
 */
describe('join-column, custom-field and doc empty $in/$nin guard (#7637)', () => {
  const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
  } })
  const engine = new HybridQueryEngine({ getKysely: () => database } as any, {} as any) as any
  const entity = 'customers:customer_entity'
  const base = () => database.selectFrom('customers as b').leftJoin('entity_indexes as ei', 'ei.entity_id', 'b.id').select('b.id')
  const sources = [{ alias: 'ei', entityId: entity, recordIdColumn: 'b.id' }]

  const builders: Array<[string, (op: string, value: unknown) => { sql: string; parameters: readonly unknown[] }]> = [
    ['join column', (op, value) => engine.applyJoinColumnFilterOp(base(), 'c.status', op, value).compile()],
    ['custom field (AND path)', (op, value) => engine.applyCfFilterFromAlias(base(), 'ei', entity, 'cf:priority', op, value).compile()],
    ['index doc (AND path)', (op, value) => engine.applyIndexDocFilterFromAlias(base(), 'ei', entity, 'status', op, value, 'b.id').compile()],
    ['index doc (OR-group path)', (op, value) =>
      base().where((eb: unknown) => engine.buildIndexDocFilterExpression(eb, 'ei', entity, 'status', op, value, 'b.id')).compile()],
    ['custom field (OR-group path)', (op, value) =>
      base().where((eb: unknown) => engine.buildCfFilterExpression(eb, 'cf:priority', op, value, sources)).compile()],
  ]

  test.each(builders)('%s: empty $in compiles to a never-match predicate', (_label, compile) => {
    const query = compile('in', [])
    expect(query.sql).not.toMatch(/in \(\s*\)/)
    expect(query.sql).toMatch(/where false$/)
  })

  test.each(builders.filter(([label]) => label !== 'custom field (OR-group path)'))(
    '%s: empty $nin compiles to an always-match predicate',
    (_label, compile) => {
      const query = compile('nin', [])
      expect(query.sql).not.toMatch(/in \(\s*\)/)
      expect(query.sql).toMatch(/where true$/)
    },
  )

  test('custom field (OR-group path): empty $nin keeps its pre-existing "has a value" predicate', () => {
    const [, compile] = builders.find(([label]) => label === 'custom field (OR-group path)')!
    const query = compile('nin', [])
    expect(query.sql).not.toMatch(/in \(\s*\)/)
    expect(query.sql).toMatch(/is not null$/)
  })

  test.each(builders.filter(([label]) => !label.startsWith('custom field')))('%s: non-empty lists keep their in-list predicates', (_label, compile) => {
    const inQuery = compile('in', ['a', 'b'])
    expect(inQuery.sql).toMatch(/ in \(\$\d+, \$\d+\)/)
    expect(inQuery.parameters).toEqual(expect.arrayContaining(['a', 'b']))
    expect(compile('nin', ['a']).sql).toMatch(/ not in \(\$\d+\)/)
  })
})
