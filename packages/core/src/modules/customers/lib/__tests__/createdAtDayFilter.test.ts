import type { AdvancedFilterTree, FilterRule } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { compileTreeToWhere } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { expandCreatedAtDayRules } from '../createdAtDayFilter'

function treeOf(...children: AdvancedFilterTree['root']['children']): AdvancedFilterTree {
  return { root: { id: 'root', type: 'group', combinator: 'and', children } }
}

function rule(field: string, operator: FilterRule['operator'], value: unknown): FilterRule {
  return { id: `${field}-${operator}`, type: 'rule', field, operator, value }
}

function compile(input: FilterRule): Record<string, unknown> | null {
  return compileTreeToWhere(expandCreatedAtDayRules(treeOf(input))!)
}

describe('expandCreatedAtDayRules', () => {
  it('turns "is <day>" into a whole-day range', () => {
    expect(compile(rule('created_at', 'is', '2026-09-01'))).toEqual({
      created_at: { $gte: '2026-09-01', $lte: '2026-09-01T23:59:59.999' },
    })
  })

  it('keeps the whole end day in a between range', () => {
    expect(compile(rule('created_at', 'between', ['2026-09-01', '2026-09-30']))).toEqual({
      created_at: { $gte: '2026-09-01', $lte: '2026-09-30T23:59:59.999' },
    })
  })

  it('makes "is after <day>" exclude that day', () => {
    expect(compile(rule('created_at', 'is_after', '2026-09-01'))).toEqual({
      created_at: { $gt: '2026-09-01T23:59:59.999' },
    })
  })

  it('leaves "is before <day>" starting at midnight of that day', () => {
    expect(compile(rule('created_at', 'is_before', '2026-09-01'))).toEqual({
      created_at: { $lt: '2026-09-01' },
    })
  })

  it('does not touch values that already carry a time', () => {
    const input = rule('created_at', 'is', '2026-09-01T10:00:00Z')
    expect(expandCreatedAtDayRules(treeOf(input))!.root.children[0]).toEqual(input)
  })

  it('does not touch other date fields', () => {
    const input = rule('next_interaction_at', 'is', '2026-09-01')
    expect(expandCreatedAtDayRules(treeOf(input))!.root.children[0]).toEqual(input)
  })

  it('rewrites created_at rules inside nested groups', () => {
    const tree = treeOf({
      id: 'nested',
      type: 'group',
      combinator: 'or',
      children: [rule('created_at', 'is', '2026-09-01'), rule('display_name', 'contains', 'acme')],
    })
    const expanded = expandCreatedAtDayRules(tree)!
    const nested = expanded.root.children[0]
    expect(nested.type).toBe('group')
    if (nested.type !== 'group') return
    expect(nested.children[0]).toMatchObject({ operator: 'between', value: ['2026-09-01', '2026-09-01T23:59:59.999'] })
    expect(nested.children[1]).toEqual(rule('display_name', 'contains', 'acme'))
  })

  it('passes null through', () => {
    expect(expandCreatedAtDayRules(null)).toBeNull()
  })
})
