/** @jest-environment node */
import {
  validateTreeLimits,
  createEmptyTree,
  compileTreeToWhere,
  serializeTreeForPersist,
  deserializeTreeFromPersist,
  isPersistedFilterTree,
  type AdvancedFilterTree,
  type FilterRule,
  type FilterGroup,
} from '../advanced-filter-tree'
import type { FilterOperator } from '../advanced-filter'

const rule = (id: string, field = 'name'): FilterRule => ({
  id, type: 'rule', field, operator: 'contains', value: 'x',
})
const group = (id: string, children: Array<FilterRule | FilterGroup>, combinator: 'and' | 'or' = 'and'): FilterGroup => ({
  id, type: 'group', combinator, children,
})

describe('validateTreeLimits', () => {
  it('accepts an empty tree', () => {
    expect(validateTreeLimits(createEmptyTree())).toEqual({ ok: true })
  })

  it('rejects a group at level 4', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [
        group('2', [
          group('3', [
            group('4', [rule('r')]),  // level 4: too deep
          ]),
        ]),
      ]),
    }
    expect(validateTreeLimits(tree)).toEqual({ ok: false, reason: 'depth' })
  })

  it('accepts the deepest legal tree (rule at level 3 inside groups at levels 1, 2, 3)', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [
        group('2', [
          group('3', [rule('r')]),
        ]),
      ]),
    }
    expect(validateTreeLimits(tree)).toEqual({ ok: true })
  })

  it('rejects a group with 16 children', () => {
    const children = Array.from({ length: 16 }, (_, i) => rule(`r${i}`))
    const tree: AdvancedFilterTree = { root: group('1', children) }
    expect(validateTreeLimits(tree)).toEqual({ ok: false, reason: 'width' })
  })

  it('rejects 51 total rules without tripping the width cap', () => {
    // Spread across four sub-groups so no group exceeds 15 children:
    // 15 + 15 + 15 + 6 = 51 total rules; root has 4 children (under width cap).
    const mk = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => rule(`${prefix}${i}`))
    const tree: AdvancedFilterTree = {
      root: group('1', [
        group('a', mk('a', 15)),
        group('b', mk('b', 15)),
        group('c', mk('c', 15)),
        group('d', mk('d', 6)),
      ]),
    }
    expect(validateTreeLimits(tree)).toEqual({ ok: false, reason: 'total' })
  })
})

describe('compileTreeToWhere — leaf rules', () => {
  it('compiles a single contains rule', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [{ id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' }]),
    }
    expect(compileTreeToWhere(tree)).toEqual({ display_name: { $ilike: '%Daniel%' } })
  })

  it('compiles "is" rule to $eq', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [{ id: 'a', type: 'rule', field: 'status', operator: 'is', value: 'Lead' }]),
    }
    expect(compileTreeToWhere(tree)).toEqual({ status: { $eq: 'Lead' } })
  })

  it('returns null for an empty root group', () => {
    expect(compileTreeToWhere(createEmptyTree())).toBeNull()
  })

  it('returns null when the only rule has an empty value (and the operator requires one)', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [{ id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: '   ' }]),
    }
    expect(compileTreeToWhere(tree)).toBeNull()
  })

  it('keeps a valueless operator (is_empty) without value', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [{ id: 'a', type: 'rule', field: 'primary_email', operator: 'is_empty', value: '' }]),
    }
    expect(compileTreeToWhere(tree)).toEqual({ primary_email: { $exists: false } })
  })
})

describe('compileTreeToWhere — group compilation', () => {
  it('AND of two rules same field — no key collision (Bug A)', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [
        { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
        { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: 'Harris' },
      ], 'and'),
    }
    expect(compileTreeToWhere(tree)).toEqual({
      $and: [
        { display_name: { $ilike: '%Daniel%' } },
        { display_name: { $ilike: '%Harris%' } },
      ],
    })
  })

  it('OR of two rules same field', () => {
    const tree: AdvancedFilterTree = {
      root: group('1', [
        { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
        { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: 'Naomi' },
      ], 'or'),
    }
    expect(compileTreeToWhere(tree)).toEqual({
      $or: [
        { display_name: { $ilike: '%Daniel%' } },
        { display_name: { $ilike: '%Naomi%' } },
      ],
    })
  })

  it('(A OR B) AND C — distinct from A OR (B AND C)', () => {
    const A: FilterRule = { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'A' }
    const B: FilterRule = { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: 'B' }
    const C: FilterRule = { id: 'c', type: 'rule', field: 'status', operator: 'is', value: 'Lead' }

    const treeAB_or_then_AND_C: AdvancedFilterTree = {
      root: group('r', [group('g', [A, B], 'or'), C], 'and'),
    }
    expect(compileTreeToWhere(treeAB_or_then_AND_C)).toEqual({
      $and: [
        { $or: [{ display_name: { $ilike: '%A%' } }, { display_name: { $ilike: '%B%' } }] },
        { status: { $eq: 'Lead' } },
      ],
    })

    const treeA_or_BC: AdvancedFilterTree = {
      root: group('r', [A, group('g', [B, C], 'and')], 'or'),
    }
    expect(compileTreeToWhere(treeA_or_BC)).toEqual({
      $or: [
        { display_name: { $ilike: '%A%' } },
        { $and: [{ display_name: { $ilike: '%B%' } }, { status: { $eq: 'Lead' } }] },
      ],
    })
  })

  it('group with 1 child after pruning unwraps to that child', () => {
    const tree: AdvancedFilterTree = {
      root: group('r', [
        { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
        { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: '   ' }, // pruned
      ], 'or'),
    }
    expect(compileTreeToWhere(tree)).toEqual({ display_name: { $ilike: '%Daniel%' } })
  })

  it('nested group with all empty rules is omitted', () => {
    const tree: AdvancedFilterTree = {
      root: group('r', [
        { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
        group('inner', [
          { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: '' },
        ], 'and'),
      ], 'and'),
    }
    expect(compileTreeToWhere(tree)).toEqual({ display_name: { $ilike: '%Daniel%' } })
  })

  it('depth-3 nesting (A AND (B OR (C AND D)))', () => {
    const A: FilterRule = { id: 'a', type: 'rule', field: 'f1', operator: 'is', value: 'a' }
    const B: FilterRule = { id: 'b', type: 'rule', field: 'f2', operator: 'is', value: 'b' }
    const C: FilterRule = { id: 'c', type: 'rule', field: 'f3', operator: 'is', value: 'c' }
    const D: FilterRule = { id: 'd', type: 'rule', field: 'f4', operator: 'is', value: 'd' }
    const tree: AdvancedFilterTree = {
      root: group('r', [A, group('o', [B, group('cd', [C, D], 'and')], 'or')], 'and'),
    }
    expect(compileTreeToWhere(tree)).toEqual({
      $and: [
        { f1: { $eq: 'a' } },
        { $or: [
          { f2: { $eq: 'b' } },
          { $and: [{ f3: { $eq: 'c' } }, { f4: { $eq: 'd' } }] },
        ]},
      ],
    })
  })
})

describe('compileTreeToWhere — every operator', () => {
  const cases: Array<[FilterOperator, unknown, Record<string, unknown>]> = [
    ['is',                'X',        { f: { $eq: 'X' } }],
    ['is_not',            'X',        { f: { $ne: 'X' } }],
    ['contains',          'X',        { f: { $ilike: '%X%' } }],
    ['does_not_contain',  'X',        { f: { $not: { $ilike: '%X%' } } }],
    ['starts_with',       'X',        { f: { $ilike: 'X%' } }],
    ['ends_with',         'X',        { f: { $ilike: '%X' } }],
    ['is_empty',          '',         { f: { $exists: false } }],
    ['is_not_empty',      '',         { f: { $exists: true } }],
    ['equals',            'X',        { f: { $eq: 'X' } }],
    ['not_equals',        'X',        { f: { $ne: 'X' } }],
    ['greater_than',      '5',        { f: { $gt: '5' } }],
    ['less_than',         '5',        { f: { $lt: '5' } }],
    ['greater_or_equal',  '5',        { f: { $gte: '5' } }],
    ['less_or_equal',     '5',        { f: { $lte: '5' } }],
    ['between',           ['1', '9'], { f: { $gte: '1', $lte: '9' } }],
    ['is_before',         '2026-01-01', { f: { $lt: '2026-01-01' } }],
    ['is_after',          '2026-01-01', { f: { $gt: '2026-01-01' } }],
    ['is_any_of',         ['a', 'b'], { f: { $in: ['a', 'b'] } }],
    ['is_none_of',        ['a'],      { f: { $nin: ['a'] } }],
    ['is_true',           '',         { f: { $eq: true } }],
    ['is_false',          '',         { f: { $eq: false } }],
    ['has_any_of',        ['t1'],     { f: { $in: ['t1'] } }],
    ['has_all_of',        ['t1', 't2'], { f: { $contains: ['t1', 't2'] } }],
    ['has_none_of',       ['t1'],     { f: { $nin: ['t1'] } }],
  ]

  it.each(cases)('compiles %s to expected output', (operator, value, expected) => {
    const tree: AdvancedFilterTree = {
      root: group('1', [{ id: 'a', type: 'rule', field: 'f', operator, value }]),
    }
    expect(compileTreeToWhere(tree)).toEqual(expected)
  })
})

describe('serializeTreeForPersist / deserializeTreeFromPersist', () => {
  // Build a tree with runtime metadata (`addedAt`) on every node, then
  // verify it is stripped from the persisted shape and restored cleanly.
  const tree: AdvancedFilterTree = {
    root: {
      id: 'root',
      type: 'group',
      combinator: 'and',
      addedAt: 11,
      children: [
        { id: 'a', type: 'rule', field: 'name', operator: 'contains', value: 'X', addedAt: 12 } as FilterRule,
        {
          id: 'sub',
          type: 'group',
          combinator: 'or',
          addedAt: 13,
          children: [
            { id: 'b', type: 'rule', field: 'status', operator: 'is', value: 'active', addedAt: 14 } as FilterRule,
            { id: 'c', type: 'rule', field: 'status', operator: 'is', value: 'lead', addedAt: 15 } as FilterRule,
          ],
        } as FilterGroup,
      ],
    },
  }

  it('serializeTreeForPersist tags v:2 and strips addedAt from every node', () => {
    const persisted = serializeTreeForPersist(tree)
    expect(persisted.v).toBe(2)
    // Walk every node and assert no addedAt key.
    function assertNoAddedAt(node: any): void {
      expect('addedAt' in node).toBe(false)
      if (node.children) for (const c of node.children) assertNoAddedAt(c)
    }
    assertNoAddedAt(persisted.root)
  })

  it('serializeTreeForPersist preserves ids, combinators, and child order', () => {
    const persisted = serializeTreeForPersist(tree)
    expect(persisted.root.id).toBe('root')
    expect(persisted.root.combinator).toBe('and')
    expect(persisted.root.children.map((c) => c.id)).toEqual(['a', 'sub'])
    const sub = persisted.root.children[1] as FilterGroup
    expect(sub.combinator).toBe('or')
    expect(sub.children.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('isPersistedFilterTree distinguishes persisted shape from legacy filterValues', () => {
    expect(isPersistedFilterTree(serializeTreeForPersist(tree))).toBe(true)
    expect(isPersistedFilterTree({ status: 'active', source: 'event' })).toBe(false) // legacy
    expect(isPersistedFilterTree(null)).toBe(false)
    expect(isPersistedFilterTree(undefined)).toBe(false)
    expect(isPersistedFilterTree({ v: 1, root: {} })).toBe(false) // wrong version
    expect(isPersistedFilterTree({ v: 2 })).toBe(false) // missing root
    expect(isPersistedFilterTree({ v: 2, root: { type: 'rule' } })).toBe(false) // root not a group
    expect(isPersistedFilterTree({ v: 2, root: { type: 'group', combinator: 'xor', children: [] } })).toBe(false)
  })

  it('round-trips through serialize → deserialize without losing structure', () => {
    const persisted = serializeTreeForPersist(tree)
    const restored = deserializeTreeFromPersist(persisted as unknown)
    expect(restored).not.toBeNull()
    if (!restored) return
    expect(restored.root.id).toBe('root')
    expect(restored.root.children.map((c) => c.id)).toEqual(['a', 'sub'])
    const sub = restored.root.children[1] as FilterGroup
    expect(sub.combinator).toBe('or')
    expect(sub.children.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('deserializeTreeFromPersist returns null for non-tree shapes', () => {
    expect(deserializeTreeFromPersist({ status: 'active' })).toBeNull()
    expect(deserializeTreeFromPersist(null)).toBeNull()
    expect(deserializeTreeFromPersist(undefined)).toBeNull()
    expect(deserializeTreeFromPersist({ v: 1, root: {} })).toBeNull()
  })

  it('compiled WHERE matches before and after a persist round-trip', () => {
    const before = compileTreeToWhere(tree)
    const restored = deserializeTreeFromPersist(serializeTreeForPersist(tree) as unknown)
    expect(restored).not.toBeNull()
    if (!restored) return
    expect(compileTreeToWhere(restored)).toEqual(before)
  })
})
