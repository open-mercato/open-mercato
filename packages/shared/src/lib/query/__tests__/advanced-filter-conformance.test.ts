import {
  OPERATORS_BY_FIELD_TYPE,
  convertAdvancedFilterToWhere,
  deserializeAdvancedFilter,
  deserializeTree,
  serializeAdvancedFilter,
  serializeTree,
  type FilterFieldType,
  type FilterOperator,
} from '../advanced-filter'
import { compileTreeToWhere, type AdvancedFilterTree } from '../advanced-filter-tree'
import { normalizeFilters } from '../join-utils'

function sampleValue(type: FilterFieldType, operator: FilterOperator): unknown {
  if (operator === 'between') return type === 'date' ? ['2026-01-01', '2026-12-31'] : [10, 20]
  if (operator.includes('_of')) return ['alpha', 'beta']
  if (type === 'number') return 10
  if (type === 'date') return '2026-01-01'
  if (type === 'boolean') return true
  return 'alpha'
}

const cases = (Object.entries(OPERATORS_BY_FIELD_TYPE) as Array<[FilterFieldType, FilterOperator[]]>)
  .flatMap(([type, operators]) => operators.filter((operator) => operator !== 'does_not_contain').map((operator) => ({ type, operator, value: sampleValue(type, operator) })))

const treeFor = (field: string, operator: FilterOperator, value: unknown): AdvancedFilterTree => ({
  root: { id: 'root', type: 'group', combinator: 'and', children: [{ id: 'rule', type: 'rule', field, operator, value }] },
})

describe.each(['display_name', 'cf_labels', 'profile.name'])('UI operator conformance on %s', (field) => {
  test.each(cases)('$type / $operator survives both compiler and normalizer paths', ({ operator, value }) => {
    const state = { logic: 'and' as const, conditions: [{ id: 'rule', field, operator, value }] }
    const restored = deserializeAdvancedFilter(serializeAdvancedFilter(state))
    expect(restored).not.toBeNull()
    const legacy = normalizeFilters(convertAdvancedFilterToWhere(restored!))
    const tree = deserializeTree(serializeTree(treeFor(field, operator, value)))
    expect(tree).not.toBeNull()
    const current = normalizeFilters(compileTreeToWhere(tree!) ?? {})
    expect(current.length).toBeGreaterThan(0)
    expect(current).toEqual(legacy)
    expect(current.every((filter) => filter.field === (field === 'cf_labels' ? 'cf:labels' : field))).toBe(true)
  })
})

test('all-tags retains every member and AND condition in both compilers', () => {
  const conditions = [
    { id: 'tags', field: 'tags', operator: 'has_all_of' as const, value: ['alpha', 'beta'] },
    { id: 'roles', field: 'role_ids', operator: 'has_all_of' as const, value: ['editor', 'viewer'] },
    { id: 'active', field: 'is_active', operator: 'is_true' as const, value: null },
  ]
  const legacy = convertAdvancedFilterToWhere({ logic: 'and', conditions })
  const current = compileTreeToWhere({ root: {
    id: 'root', type: 'group', combinator: 'and', children: conditions.map((condition) => ({ ...condition, type: 'rule' })),
  } })
  expect(normalizeFilters(current ?? {})).toEqual(normalizeFilters(legacy))
  expect(normalizeFilters(legacy)).toEqual([
    { field: 'tags', op: 'overlap', value: ['alpha'] },
    { field: 'tags', op: 'overlap', value: ['beta'] },
    { field: 'role_ids', op: 'overlap', value: ['editor'] },
    { field: 'role_ids', op: 'overlap', value: ['viewer'] },
    { field: 'is_active', op: 'eq', value: true },
  ])
})
