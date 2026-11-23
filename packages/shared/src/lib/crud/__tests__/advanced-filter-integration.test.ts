/** @jest-environment node */
import { mergeAdvancedFilters, mergeAdvancedFilterTree, mergeAdvancedFiltersFromQuery } from '../advanced-filter-integration'
import type { AdvancedFilterTree, FilterRule, FilterGroup } from '../../query/advanced-filter-tree'
import { createEmptyTree } from '../../query/advanced-filter-tree'

const rule = (field: string, value: string): FilterRule => ({
  id: field, type: 'rule', field, operator: 'contains', value,
})
const group = (combinator: 'and' | 'or', children: Array<FilterRule | FilterGroup>): FilterGroup => ({
  id: combinator, type: 'group', combinator, children,
})
const treeOf = (root: FilterGroup): AdvancedFilterTree => ({ root })

describe('mergeAdvancedFilterTree', () => {
  it('returns route filters unchanged when tree is null', () => {
    expect(mergeAdvancedFilterTree({ kind: 'person' }, null)).toEqual({ kind: 'person' })
  })

  it('returns route filters unchanged when tree is empty', () => {
    expect(mergeAdvancedFilterTree({ kind: 'person' }, createEmptyTree())).toEqual({ kind: 'person' })
  })

  it('returns the tree where when route filters are empty', () => {
    const tree = treeOf(group('and', [rule('display_name', 'Daniel')]))
    expect(mergeAdvancedFilterTree({}, tree)).toEqual({ display_name: { $ilike: '%Daniel%' } })
  })

  it('AND-combines route filters with tree output via $and', () => {
    const tree = treeOf(group('and', [
      rule('display_name', 'Daniel'),
      rule('display_name', 'Harris'),
    ]))
    expect(mergeAdvancedFilterTree({ kind: 'person' }, tree)).toEqual({
      $and: [
        { kind: 'person' },
        { $and: [
          { display_name: { $ilike: '%Daniel%' } },
          { display_name: { $ilike: '%Harris%' } },
        ]},
      ],
    })
  })

  it('preserves nested OR groups in the AND-combined output', () => {
    const tree = treeOf(group('and', [
      group('or', [rule('display_name', 'Daniel'), rule('display_name', 'Naomi')]),
      rule('status', 'Lead'),
    ]))
    expect(mergeAdvancedFilterTree({ kind: 'person' }, tree)).toEqual({
      $and: [
        { kind: 'person' },
        { $and: [
          { $or: [
            { display_name: { $ilike: '%Daniel%' } },
            { display_name: { $ilike: '%Naomi%' } },
          ]},
          { status: { $ilike: '%Lead%' } },
        ]},
      ],
    })
  })
})

describe('mergeAdvancedFiltersFromQuery', () => {
  it('parses v2 tree URLs', () => {
    const out = mergeAdvancedFiltersFromQuery(
      { kind: 'person' },
      {
        'filter[v]': '2',
        'filter[root][combinator]': 'and',
        'filter[root][children][0][type]': 'rule',
        'filter[root][children][0][field]': 'display_name',
        'filter[root][children][0][op]': 'contains',
        'filter[root][children][0][value]': 'Daniel',
      },
    )
    expect(out).toEqual({
      $and: [
        { kind: 'person' },
        { display_name: { $ilike: '%Daniel%' } },
      ],
    })
  })

  it('upgrades legacy v1 URLs into a tree under SQL precedence', () => {
    const out = mergeAdvancedFiltersFromQuery(
      { kind: 'person' },
      {
        'filter[logic]': 'and',
        'filter[conditions][0][field]': 'display_name',
        'filter[conditions][0][op]': 'contains',
        'filter[conditions][0][value]': 'Daniel',
        'filter[conditions][1][field]': 'display_name',
        'filter[conditions][1][op]': 'contains',
        'filter[conditions][1][value]': 'Naomi',
        'filter[conditions][1][join]': 'or',
      },
    )
    expect(out).toEqual({
      $and: [
        { kind: 'person' },
        { $or: [
          { display_name: { $ilike: '%Daniel%' } },
          { display_name: { $ilike: '%Naomi%' } },
        ]},
      ],
    })
  })

  it('returns route filters unchanged when no advanced filter present', () => {
    expect(mergeAdvancedFiltersFromQuery({ kind: 'person' }, { page: '1' })).toEqual({ kind: 'person' })
  })
})

describe('mergeAdvancedFilters security intersection', () => {
  const query = {
    'filter[conditions][0][field]': 'member_id',
    'filter[conditions][0][op]': 'is_not_empty',
  }

  it('keeps route filters unchanged when client filters are absent or unusable', () => {
    const routeFilters = { member_id: 'member-1' }
    expect(mergeAdvancedFilters(routeFilters, {})).toBe(routeFilters)
    expect(mergeAdvancedFilters(routeFilters, {
      'filter[conditions][0][field]': 'member_id',
      'filter[conditions][0][op]': 'is',
      'filter[conditions][0][value]': '',
    })).toBe(routeFilters)
  })

  it('keeps client-only filters working when route filters are empty', () => {
    expect(mergeAdvancedFilters({}, query)).toEqual({ member_id: { $exists: true } })
  })

  it('preserves same-field server predicates without mutating either input', () => {
    const routeFilters = Object.freeze({ member_id: Object.freeze({ $eq: 'member-1' }) })
    const clientQuery = Object.freeze({ ...query })
    expect(mergeAdvancedFilters(routeFilters, clientQuery)).toEqual({
      $and: [routeFilters, { member_id: { $exists: true } }],
    })
    expect(routeFilters.member_id).toEqual({ $eq: 'member-1' })
    expect(clientQuery).toEqual(query)
  })

  it('AND-combines direct scope and both overlapping OR groups', () => {
    const routeFilters = {
      tenant_id: 'tenant-1',
      $or: [{ member_id: 'member-1' }, { member_id: 'member-2' }],
    }
    expect(mergeAdvancedFilters(routeFilters, {
      ...query,
      'filter[logic]': 'or',
      'filter[conditions][1][field]': 'member_id',
      'filter[conditions][1][op]': 'is',
      'filter[conditions][1][value]': 'outsider',
    })).toEqual({
      $and: [routeFilters, {
        $or: [{ member_id: { $exists: true } }, { member_id: { $eq: 'outsider' } }],
      }],
    })
  })

  it('preserves a nested route AND when client conditions target the same field', () => {
    const routeFilters = { $and: [{ member_id: 'member-1' }, { id: { $in: ['allowed'] } }] }
    expect(mergeAdvancedFilters(routeFilters, query)).toEqual({
      $and: [routeFilters, { member_id: { $exists: true } }],
    })
  })
})
