/** @jest-environment node */
import {
  serializeTree,
  deserializeTree,
  flatToTree,
  type AdvancedFilterState,
  type FilterCondition,
} from '../advanced-filter'
import type { AdvancedFilterTree, FilterCombinator } from '../advanced-filter-tree'

describe('serializeTree', () => {
  it('omits params for an empty tree', () => {
    expect(serializeTree({
      root: { id: 'r', type: 'group', combinator: 'and', children: [] },
    })).toEqual({})
  })

  it('emits v2 bracketed params for a single rule', () => {
    const tree: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and',
        children: [{ id: 'c', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' }],
      },
    }
    expect(serializeTree(tree)).toEqual({
      'filter[v]': '2',
      'filter[root][combinator]': 'and',
      'filter[root][children][0][type]': 'rule',
      'filter[root][children][0][field]': 'display_name',
      'filter[root][children][0][op]': 'contains',
      'filter[root][children][0][value]': 'Daniel',
    })
  })

  it('emits nested groups recursively', () => {
    const tree: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and',
        children: [
          {
            id: 'g', type: 'group', combinator: 'or',
            children: [
              { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
              { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: 'Naomi' },
            ],
          },
          { id: 'c', type: 'rule', field: 'status', operator: 'is', value: 'Lead' },
        ],
      },
    }
    expect(serializeTree(tree)).toMatchObject({
      'filter[v]': '2',
      'filter[root][combinator]': 'and',
      'filter[root][children][0][type]': 'group',
      'filter[root][children][0][combinator]': 'or',
      'filter[root][children][0][children][0][type]': 'rule',
      'filter[root][children][0][children][0][field]': 'display_name',
      'filter[root][children][0][children][0][op]': 'contains',
      'filter[root][children][0][children][0][value]': 'Daniel',
      'filter[root][children][0][children][1][value]': 'Naomi',
      'filter[root][children][1][type]': 'rule',
      'filter[root][children][1][field]': 'status',
      'filter[root][children][1][op]': 'is',
      'filter[root][children][1][value]': 'Lead',
    })
  })

  it('omits value param for valueless operators', () => {
    const tree: AdvancedFilterTree = {
      root: {
        id: 'r', type: 'group', combinator: 'and',
        children: [{ id: 'a', type: 'rule', field: 'primary_email', operator: 'is_empty', value: '' }],
      },
    }
    const out = serializeTree(tree)
    expect(out['filter[root][children][0][op]']).toBe('is_empty')
    expect(out['filter[root][children][0][value]']).toBeUndefined()
  })
})

describe('deserializeTree (v2)', () => {
  it('round-trips a nested tree', () => {
    const tree: AdvancedFilterTree = {
      root: { id: 'r', type: 'group', combinator: 'and', children: [
        { id: 'g', type: 'group', combinator: 'or', children: [
          { id: 'a', type: 'rule', field: 'display_name', operator: 'contains', value: 'Daniel' },
          { id: 'b', type: 'rule', field: 'display_name', operator: 'contains', value: 'Naomi' },
        ]},
        { id: 'c', type: 'rule', field: 'status', operator: 'is', value: 'Lead' },
      ]},
    }
    const params = serializeTree(tree)
    const round = deserializeTree(params)
    // ids are regenerated; compare structure only.
    type StripNode =
      | { type: 'rule'; field: string; operator: string; value: unknown }
      | { type: 'group'; combinator: FilterCombinator; children: StripNode[] }
    const stripIds = (node: any): StripNode =>
      node.type === 'rule'
        ? { type: 'rule', field: node.field, operator: node.operator, value: node.value }
        : { type: 'group', combinator: node.combinator, children: node.children.map(stripIds) }
    expect(round).not.toBeNull()
    expect(stripIds(round!.root)).toEqual(stripIds(tree.root))
  })

  it('returns null when filter[v] is not 2', () => {
    expect(deserializeTree({ 'filter[v]': '1' })).toBeNull()
    expect(deserializeTree({})).toBeNull()
  })

  it('returns null when root combinator is missing', () => {
    expect(deserializeTree({ 'filter[v]': '2' })).toBeNull()
  })

  it('parses a valueless operator with no value param', () => {
    const out = deserializeTree({
      'filter[v]': '2',
      'filter[root][combinator]': 'and',
      'filter[root][children][0][type]': 'rule',
      'filter[root][children][0][field]': 'primary_email',
      'filter[root][children][0][op]': 'is_empty',
    })
    expect(out).not.toBeNull()
    expect(out!.root.children[0]).toMatchObject({ type: 'rule', operator: 'is_empty' })
  })
})

describe('flatToTree — legacy v1 -> tree (SQL precedence)', () => {
  const cond = (field: string, value: string, join: 'and' | 'or' = 'and'): FilterCondition => ({
    id: field, field, operator: 'contains', value, join,
  })

  it('A AND B AND C -> single AND group', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'and'), cond('b', 'y', 'and'), cond('c', 'z', 'and')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('and')
    expect(tree.root.children).toHaveLength(3)
    expect(tree.root.children.every((c) => c.type === 'rule')).toBe(true)
  })

  it('A OR B OR C -> single OR group', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'and'), cond('b', 'y', 'or'), cond('c', 'z', 'or')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('or')
    expect(tree.root.children).toHaveLength(3)
    expect(tree.root.children.every((c) => c.type === 'rule')).toBe(true)
  })

  it('A AND B OR C AND D -> OR(AND(A,B), AND(C,D))', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'and'), cond('b', 'y', 'and'), cond('c', 'z', 'or'), cond('d', 'w', 'and')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('or')
    expect(tree.root.children).toHaveLength(2)
    const [first, second] = tree.root.children
    expect(first.type).toBe('group')
    expect(second.type).toBe('group')
    if (first.type === 'group') {
      expect(first.combinator).toBe('and')
      expect(first.children).toHaveLength(2)
    }
    if (second.type === 'group') {
      expect(second.combinator).toBe('and')
      expect(second.children).toHaveLength(2)
    }
  })

  it('A OR B AND C -> OR(A, AND(B,C))', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'and'), cond('b', 'y', 'or'), cond('c', 'z', 'and')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('or')
    expect(tree.root.children).toHaveLength(2)
    expect(tree.root.children[0].type).toBe('rule')
    expect(tree.root.children[1].type).toBe('group')
    if (tree.root.children[1].type === 'group') {
      expect(tree.root.children[1].combinator).toBe('and')
      expect(tree.root.children[1].children).toHaveLength(2)
    }
  })

  it('first row join is forced to AND even if user set "or"', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'or'), cond('b', 'y', 'and')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('and')
    expect(tree.root.children).toHaveLength(2)
  })

  it('single rule -> root group with one rule', () => {
    const flat: AdvancedFilterState = {
      logic: 'and',
      conditions: [cond('a', 'x', 'and')],
    }
    const tree = flatToTree(flat)
    expect(tree.root.combinator).toBe('and')
    expect(tree.root.children).toHaveLength(1)
    expect(tree.root.children[0].type).toBe('rule')
  })

  it('empty conditions -> empty root', () => {
    const flat: AdvancedFilterState = { logic: 'and', conditions: [] }
    const tree = flatToTree(flat)
    expect(tree.root.children).toHaveLength(0)
  })
})
