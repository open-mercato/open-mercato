/**
 * #7502: see the matching test file in `@open-mercato/shared/lib/query/__tests__`
 * for the full context. `HybridQueryEngine` has the same two where-builders
 * (AND-path `applyColumnFilter`, OR-group-path `buildColumnFilterExpression`)
 * that used to pass an empty `$in`/`$nin` array straight to Kysely, compiling
 * to invalid SQL (`in ()`, 42601) instead of a predicate that matches nothing.
 */
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
