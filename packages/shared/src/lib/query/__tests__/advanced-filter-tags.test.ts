/** @jest-environment node */
import { makeMultiRuleTree, type AdvancedFilterTree } from '../advanced-filter-tree'
import { serializeAdvancedFilter, type AdvancedFilterState, type FilterOperator } from '../advanced-filter'
import { mergeAdvancedFilters, mergeAdvancedFiltersFromQuery, mergeAdvancedFilterTree } from '../../crud/advanced-filter-integration'
import { normalizeFilters } from '../join-utils'

type Row = { id: string; tags: string[] }

const rows: Row[] = [
  { id: 'vip-eu', tags: ['vip', 'eu'] },
  { id: 'vip', tags: ['vip'] },
  { id: 'eu', tags: ['eu'] },
  { id: 'none', tags: [] },
]

type NormalizedFilter = ReturnType<typeof normalizeFilters>[number]

function leafMatches(row: Row, filter: NormalizedFilter): boolean {
  const values = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
  const cell = (row as Record<string, unknown>)[filter.field]
  if (!Array.isArray(cell)) return false
  const overlaps = values.some((value) => cell.includes(value))
  if (filter.op === 'overlap') return overlaps
  if (filter.op === 'noverlap') return !overlaps
  throw new Error(`[internal] unexpected operator for an array column: ${filter.op}`)
}

function matchingIds(filters: NormalizedFilter[]): string[] {
  const required = filters.filter((filter) => !filter.orGroup)
  const orGroups = new Map<string, NormalizedFilter[]>()
  for (const filter of filters) {
    if (!filter.orGroup) continue
    orGroups.set(filter.orGroup, [...(orGroups.get(filter.orGroup) ?? []), filter])
  }
  return rows
    .filter((row) => required.every((filter) => leafMatches(row, filter)))
    .filter((row) =>
      orGroups.size === 0 ||
      [...orGroups.values()].some((group) => group.every((filter) => leafMatches(row, filter))),
    )
    .map((row) => row.id)
}

type TagsRule = { operator: FilterOperator; value: string[] }
type Logic = 'and' | 'or'

function treeOf(rules: TagsRule[], logic: Logic): AdvancedFilterTree {
  return makeMultiRuleTree(rules.map((rule) => ({ field: 'tags', ...rule })), logic)
}

function flatOf(rules: TagsRule[], logic: Logic): AdvancedFilterState {
  return {
    logic,
    conditions: rules.map((rule, index) => ({ id: `c${index}`, field: 'tags', join: logic, ...rule })),
  }
}

const viaTree = (rules: TagsRule[], logic: Logic = 'and') =>
  matchingIds(normalizeFilters(mergeAdvancedFilterTree({}, treeOf(rules, logic))))

const viaFlat = (rules: TagsRule[], logic: Logic = 'and') =>
  matchingIds(normalizeFilters(mergeAdvancedFilters({}, serializeAdvancedFilter(flatOf(rules, logic)))))

const viaFlatQuery = (rules: TagsRule[], logic: Logic = 'and') =>
  matchingIds(normalizeFilters(mergeAdvancedFiltersFromQuery({}, serializeAdvancedFilter(flatOf(rules, logic)))))

describe.each([
  ['tree filter', viaTree],
  ['flat filter', viaFlat],
  ['flat filter upgraded to a tree', viaFlatQuery],
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

  it.each([
    ['has all of first', [{ operator: 'has_all_of', value: ['vip', 'eu'] }, { operator: 'has_any_of', value: ['vip'] }]],
    ['has any of first', [{ operator: 'has_any_of', value: ['vip'] }, { operator: 'has_all_of', value: ['vip', 'eu'] }]],
  ] as Array<[string, TagsRule[]]>)(
    'ORing has all of with a has any of it implies keeps every row the broader rule matches (%s)',
    (_order, rules) => {
      expect(run(rules, 'or')).toEqual(['vip-eu', 'vip'])
    },
  )

  it('ORing has all of with a disjoint has none of keeps both rules\' rows', () => {
    expect(
      run(
        [
          { operator: 'has_all_of', value: ['vip', 'eu'] },
          { operator: 'has_none_of', value: ['vip', 'eu'] },
        ],
        'or',
      ),
    ).toEqual(['vip-eu', 'none'])
  })
})
