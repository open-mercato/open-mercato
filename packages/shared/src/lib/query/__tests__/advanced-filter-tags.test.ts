/** @jest-environment node */
import { makeMultiRuleTree, type AdvancedFilterTree } from '../advanced-filter-tree'
import { serializeAdvancedFilter, type AdvancedFilterState, type FilterOperator } from '../advanced-filter'
import { mergeAdvancedFilters, mergeAdvancedFilterTree } from '../../crud/advanced-filter-integration'
import { normalizeFilters } from '../join-utils'

type Row = { id: string; tags: string[] }

const rows: Row[] = [
  { id: 'vip-eu', tags: ['vip', 'eu'] },
  { id: 'vip', tags: ['vip'] },
  { id: 'eu', tags: ['eu'] },
  { id: 'none', tags: [] },
]

function matchingIds(filters: ReturnType<typeof normalizeFilters>): string[] {
  return rows
    .filter((row) =>
      filters.every((filter) => {
        expect(filter.orGroup).toBeUndefined()
        const values = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
        const cell = (row as Record<string, unknown>)[filter.field]
        if (!Array.isArray(cell)) return false
        const overlaps = values.some((value) => cell.includes(value))
        if (filter.op === 'overlap') return overlaps
        if (filter.op === 'noverlap') return !overlaps
        throw new Error(`[internal] unexpected operator for an array column: ${filter.op}`)
      }),
    )
    .map((row) => row.id)
}

function treeOf(rules: Array<{ operator: FilterOperator; value: string[] }>): AdvancedFilterTree {
  return makeMultiRuleTree(rules.map((rule) => ({ field: 'tags', ...rule })))
}

function flatOf(rules: Array<{ operator: FilterOperator; value: string[] }>): AdvancedFilterState {
  return {
    logic: 'and',
    conditions: rules.map((rule, index) => ({ id: `c${index}`, field: 'tags', join: 'and', ...rule })),
  }
}

const viaTree = (rules: Array<{ operator: FilterOperator; value: string[] }>) =>
  matchingIds(normalizeFilters(mergeAdvancedFilterTree({}, treeOf(rules))))

const viaFlat = (rules: Array<{ operator: FilterOperator; value: string[] }>) =>
  matchingIds(normalizeFilters(mergeAdvancedFilters({}, serializeAdvancedFilter(flatOf(rules)))))

describe.each([
  ['tree filter', viaTree],
  ['flat filter', viaFlat],
])('tags operators through the %s', (_label, run) => {
  it('has all of keeps only rows carrying every value', () => {
    expect(run([{ operator: 'has_all_of', value: ['vip', 'eu'] }])).toEqual(['vip-eu'])
  })

  it('has any of keeps rows carrying at least one value', () => {
    expect(run([{ operator: 'has_any_of', value: ['vip', 'eu'] }])).toEqual(['vip-eu', 'vip', 'eu'])
  })

  it('has none of keeps rows carrying none of the values', () => {
    expect(run([{ operator: 'has_none_of', value: ['vip'] }])).toEqual(['eu', 'none'])
  })

  it('combines two has all of conditions instead of letting one replace the other', () => {
    expect(
      run([
        { operator: 'has_all_of', value: ['vip'] },
        { operator: 'has_all_of', value: ['eu'] },
      ]),
    ).toEqual(['vip-eu'])
  })
})
