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
