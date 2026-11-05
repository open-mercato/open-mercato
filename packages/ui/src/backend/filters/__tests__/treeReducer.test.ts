/** @jest-environment node */
import {
  treeReducer,
  canAddRule,
  canAddGroup,
} from '../treeReducer'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

const seed: AdvancedFilterTree = {
  root: {
    id: 'r', type: 'group', combinator: 'and',
    children: [{ id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' }],
  },
}

describe('treeReducer', () => {
  it('addRule appends a rule to the target group', () => {
    const next = treeReducer(seed, { type: 'addRule', groupId: 'r' })
    expect(next.root.children).toHaveLength(2)
    expect(next.root.children[1].type).toBe('rule')
  })

  it('addGroup appends a nested group with one empty rule', () => {
    const next = treeReducer(seed, { type: 'addGroup', groupId: 'r' })
    const last = next.root.children[next.root.children.length - 1]
    expect(last.type).toBe('group')
    if (last.type === 'group') {
      expect(last.combinator).toBe('and')
      expect(last.children).toHaveLength(1)
      expect(last.children[0].type).toBe('rule')
    }
  })

  it('removeNode removes by id', () => {
    const next = treeReducer(seed, { type: 'removeNode', nodeId: 'a' })
    expect(next.root.children).toHaveLength(0)
  })

  it('updateRule patches field/op/value', () => {
    const next = treeReducer(seed, { type: 'updateRule', ruleId: 'a', updates: { value: 'Naomi' } })
    expect((next.root.children[0] as any).value).toBe('Naomi')
  })

  it('updateGroupCombinator flips and|or', () => {
    const next = treeReducer(seed, { type: 'updateGroupCombinator', groupId: 'r', combinator: 'or' })
    expect(next.root.combinator).toBe('or')
  })

  it('addRule rejected when group has 15 children', () => {
    const big: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and',
        children: Array.from({ length: 15 }, (_, i) => ({
          id: `r${i}`, type: 'rule' as const, field: 'f', operator: 'is' as const, value: 'x',
        })),
      },
    }
    const next = treeReducer(big, { type: 'addRule', groupId: 'r' })
    expect(next).toBe(big) // rejected; identity preserved
  })

  it('addGroup rejected at level 3', () => {
    const t: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and', children: [
          {
            id: 'g2', type: 'group', combinator: 'and', children: [
              {
                id: 'g3', type: 'group', combinator: 'and', children: [
                  { id: 'rr', type: 'rule', field: 'f', operator: 'is', value: 'x' },
                ],
              },
            ],
          },
        ],
      },
    }
    const next = treeReducer(t, { type: 'addGroup', groupId: 'g3' })
    expect(next).toBe(t)
  })

  it('addRule rejected at total cap', () => {
    // 50 rules across 4 sub-groups (15+15+15+5), each under width cap
    const mk = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i}`, type: 'rule' as const, field: 'f', operator: 'is' as const, value: 'x',
      }))
    const t: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and', children: [
          { id: 'a', type: 'group', combinator: 'and', children: mk('a', 15) },
          { id: 'b', type: 'group', combinator: 'and', children: mk('b', 15) },
          { id: 'c', type: 'group', combinator: 'and', children: mk('c', 15) },
          { id: 'd', type: 'group', combinator: 'and', children: mk('d', 5) },
        ],
      },
    }
    const next = treeReducer(t, { type: 'addRule', groupId: 'a' })
    expect(next).toBe(t)
  })
})

describe('canAddRule / canAddGroup', () => {
  it('canAddGroup returns false at level 3', () => {
    const t: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and', children: [
          {
            id: 'g2', type: 'group', combinator: 'and', children: [
              { id: 'g3', type: 'group', combinator: 'and', children: [] },
            ],
          },
        ],
      },
    }
    expect(canAddGroup(t, 'g3')).toBe(false)
    expect(canAddGroup(t, 'g2')).toBe(true) // adding into g2 produces a level-3 group
    expect(canAddGroup(t, 'r')).toBe(true)
  })

  it('canAddRule returns false at width cap', () => {
    const t: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and',
        children: Array.from({ length: 15 }, (_, i) => ({
          id: `r${i}`, type: 'rule' as const, field: 'f', operator: 'is' as const, value: 'x',
        })),
      },
    }
    expect(canAddRule(t, 'r')).toBe(false)
  })
})

describe('treeReducer — reorderChildren', () => {
  it('swaps two children inside the same group', () => {
    const tree: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [
      { id: 'a', type: 'rule', field: 'name', operator: 'contains', value: 'X' } as any,
      { id: 'b', type: 'rule', field: 'name', operator: 'contains', value: 'Y' } as any,
      { id: 'c', type: 'rule', field: 'name', operator: 'contains', value: 'Z' } as any,
    ] } }
    const out = treeReducer(tree, { type: 'reorderChildren', groupId: 'r', fromIdx: 0, toIdx: 2 })
    expect(out.root.children.map((c: any) => c.id)).toEqual(['b', 'c', 'a'])
  })
  it('no-op when group not found', () => {
    const tree: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [] } }
    expect(treeReducer(tree, { type: 'reorderChildren', groupId: 'missing', fromIdx: 0, toIdx: 1 })).toBe(tree)
  })
})

describe('treeReducer — removeLast', () => {
  it('removes the rule with the highest addedAt', () => {
    const tree: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [
      { id: 'a', type: 'rule', field: 'name', operator: 'contains', value: 'X', addedAt: 1 } as any,
      { id: 'b', type: 'rule', field: 'name', operator: 'contains', value: 'Y', addedAt: 3 } as any,
      { id: 'c', type: 'rule', field: 'name', operator: 'contains', value: 'Z', addedAt: 2 } as any,
    ] } }
    const out = treeReducer(tree, { type: 'removeLast' })
    expect(out.root.children.map((c: any) => c.id)).toEqual(['a', 'c'])
  })
  it('no-op when no node has addedAt', () => {
    const tree: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [] } }
    expect(treeReducer(tree, { type: 'removeLast' })).toBe(tree)
  })
})

describe('treeReducer — replaceRoot', () => {
  it('overwrites the root group', () => {
    const tree: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [] } }
    const newRoot = { id: 'r2', type: 'group' as const, combinator: 'or' as const, children: [] }
    const out = treeReducer(tree, { type: 'replaceRoot', root: newRoot })
    expect(out.root.id).toBe('r2')
    expect(out.root.combinator).toBe('or')
  })
})

describe('treeReducer — addedAt stamping', () => {
  it('stamps addedAt on addRule', () => {
    const before: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [] } }
    const after = treeReducer(before, { type: 'addRule', groupId: 'r' })
    const inserted = after.root.children[0] as any
    expect(typeof inserted.addedAt).toBe('number')
  })
  it('stamps addedAt on addGroup', () => {
    const before: AdvancedFilterTree = { root: { id: 'r', type: 'group', combinator: 'and', children: [] } }
    const after = treeReducer(before, { type: 'addGroup', groupId: 'r' })
    const inserted = after.root.children[0] as any
    expect(typeof inserted.addedAt).toBe('number')
  })
})
