/** @jest-environment node */

import {
  convertAdvancedFilterToWhere,
  deserializeAdvancedFilter,
  serializeAdvancedFilter,
  type AdvancedFilterState,
} from '../advanced-filter'

describe('advanced filter', () => {
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
