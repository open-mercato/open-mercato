/** @jest-environment node */

import {
  convertAdvancedFilterToWhere,
  deserializeAdvancedFilter,
  deserializeTree,
  serializeAdvancedFilter,
  type AdvancedFilterState,
} from '../advanced-filter'
import { normalizeFilters } from '../join-utils'

describe('advanced filter', () => {
  it.each([
    { field: 'active', first: 'is_true', firstValue: null, second: 'is_false', secondValue: null, expected: [{ op: 'eq', value: true }, { op: 'eq', value: false }] },
    { field: 'title', first: 'equals', firstValue: 'X', second: 'not_equals', secondValue: 'X', expected: [{ op: 'eq', value: 'X' }, { op: 'ne', value: 'X' }] },
    { field: 'amount', first: 'greater_than', firstValue: 10, second: 'less_than', secondValue: 20, expected: [{ op: 'gt', value: 10 }, { op: 'lt', value: 20 }] },
    { field: 'tags', first: 'has_any_of', firstValue: ['vip'], second: 'has_none_of', secondValue: ['eu'], expected: [{ op: 'in', value: ['vip'] }, { op: 'nin', value: ['eu'] }] },
  ] as const)('preserves both $first and $second predicates on $field in either order', (scenario) => {
    const conditions: AdvancedFilterState['conditions'] = [
      { id: 'first', field: scenario.field, operator: scenario.first, value: scenario.firstValue },
      { id: 'second', field: scenario.field, operator: scenario.second, value: scenario.secondValue },
    ]
    for (const ordered of [conditions, [...conditions].reverse()]) {
      const compiled = convertAdvancedFilterToWhere({ logic: 'and', conditions: ordered })
      const expected = scenario.expected.map((predicate) => ({ field: scenario.field, ...predicate }))
      const normalized = normalizeFilters(compiled)
      expect(normalized).toHaveLength(2)
      expect(normalized).toEqual(expect.arrayContaining(expected))
    }
  })

  it('preserves three AND predicates with the same operator on one field', () => {
    const compiled = convertAdvancedFilterToWhere({
      logic: 'and',
      conditions: ['solar', 'energy', 'systems'].map((value) => ({
        id: value, field: 'display_name', operator: 'contains', value,
      })),
    })
    expect(normalizeFilters(compiled)).toEqual([
      { field: 'display_name', op: 'ilike', value: '%solar%' },
      { field: 'display_name', op: 'ilike', value: '%energy%' },
      { field: 'display_name', op: 'ilike', value: '%systems%' },
    ])
  })

  it('keeps repeated AND predicates in each existing OR clause', () => {
    expect(convertAdvancedFilterToWhere({
      logic: 'and',
      conditions: [
        { id: '1', field: 'title', operator: 'contains', value: 'solar' },
        { id: '2', field: 'title', operator: 'contains', value: 'wind', join: 'or' },
        { id: '3', field: 'title', operator: 'does_not_contain', value: 'draft', join: 'and' },
      ],
    })).toEqual({
      $or: [
        { $and: [{ title: { $ilike: '%solar%' } }, { title: { $not: { $ilike: '%draft%' } } }] },
        { $and: [{ title: { $ilike: '%wind%' } }, { title: { $not: { $ilike: '%draft%' } } }] },
      ],
    })
  })

  it('serializes per-row join operators and compiles mixed joins into OR clauses', () => {
    const state: AdvancedFilterState = {
      logic: 'and',
      conditions: [
        { id: '1', field: 'display_name', operator: 'contains', value: 'solar', join: 'and' },
        { id: '2', field: 'primary_email', operator: 'contains', value: 'info', join: 'or' },
        { id: '3', field: 'company_profile.domain', operator: 'contains', value: 'com', join: 'and' },
      ],
    }

    expect(serializeAdvancedFilter(state)).toMatchObject({
      'filter[logic]': 'and',
      'filter[conditions][1][join]': 'or',
      'filter[conditions][2][join]': 'and',
    })

    expect(convertAdvancedFilterToWhere(state)).toEqual({
      $or: [
        {
          display_name: { $ilike: '%solar%' },
          'company_profile.domain': { $ilike: '%com%' },
        },
        {
          primary_email: { $ilike: '%info%' },
          'company_profile.domain': { $ilike: '%com%' },
        },
      ],
    })
  })

  it('keeps backward compatibility with legacy global logic query params', () => {
    expect(
      deserializeAdvancedFilter({
        'filter[logic]': 'or',
        'filter[conditions][0][field]': 'display_name',
        'filter[conditions][0][op]': 'contains',
        'filter[conditions][0][value]': 'solar',
        'filter[conditions][1][field]': 'primary_email',
        'filter[conditions][1][op]': 'contains',
        'filter[conditions][1][value]': 'info',
      }),
    ).toEqual({
      logic: 'or',
      conditions: [
        { id: '0', field: 'display_name', operator: 'contains', value: 'solar', join: 'and' },
        { id: '1', field: 'primary_email', operator: 'contains', value: 'info', join: 'or' },
      ],
    })
  })

  it('drops conditions whose field names a Where combinator instead of a column', () => {
    // `$and`/`$or`/`$not` live in the same key namespace as column names, so a condition naming one
    // would compile to a combinator key and collide with whatever the route put there — including a
    // scope predicate. Dropped like an unrecognized operator, leaving the remaining conditions.
    expect(
      deserializeAdvancedFilter({
        'filter[conditions][0][field]': '$and',
        'filter[conditions][0][op]': 'is_empty',
        'filter[conditions][1][field]': 'platform',
        'filter[conditions][1][op]': 'is',
        'filter[conditions][1][value]': 'ios',
      }),
    ).toEqual({
      logic: 'and',
      conditions: [{ id: '1', field: 'platform', operator: 'is', value: 'ios', join: 'and' }],
    })

    expect(
      deserializeAdvancedFilter({
        'filter[conditions][0][field]': '$or',
        'filter[conditions][0][op]': 'is_empty',
      }),
    ).toBeNull()

    expect(
      deserializeTree({
        'filter[v]': '2',
        'filter[root][combinator]': 'and',
        'filter[root][children][0][type]': 'rule',
        'filter[root][children][0][field]': '$and',
        'filter[root][children][0][op]': 'is_empty',
      })?.root.children,
    ).toEqual([])
  })

  it('ignores empty values for operators that require a concrete value', () => {
    expect(
      convertAdvancedFilterToWhere({
        logic: 'and',
        conditions: [
          { id: '0', field: 'next_interaction_at', operator: 'is_after', value: '' },
          { id: '1', field: 'lifecycle_stage', operator: 'is', value: 'customer', join: 'or' },
          { id: '2', field: 'primary_email', operator: 'contains', value: '   ' },
        ],
      }),
    ).toEqual({
      lifecycle_stage: { $eq: 'customer' },
    })
  })
})
