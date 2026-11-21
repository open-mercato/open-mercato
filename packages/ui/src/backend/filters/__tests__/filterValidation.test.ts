// packages/ui/src/backend/filters/__tests__/filterValidation.test.ts
import { validateTreeForApply, type ValidationError } from '../filterValidation'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'created_at', label: 'Created', type: 'date' },
  { key: 'tags', label: 'Tags', type: 'tags' },
  { key: 'status', label: 'Status', type: 'select' },
]

function tree(...children: any[]): AdvancedFilterTree {
  return { root: { id: 'r', type: 'group', combinator: 'and', children } }
}

describe('validateTreeForApply', () => {
  it('returns ok for empty tree', () => {
    expect(validateTreeForApply(tree(), fields)).toEqual({ ok: true })
  })

  it('flags rule with empty value on value-required op', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'name', operator: 'contains', value: '' })
    const r = validateTreeForApply(t, fields)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].ruleId).toBe('a')
  })

  it('passes valueless operator without value', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'name', operator: 'is_empty', value: undefined })
    expect(validateTreeForApply(t, fields)).toEqual({ ok: true })
  })

  it('flags multi-value op with empty array', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'tags', operator: 'has_any_of', value: [] })
    const r = validateTreeForApply(t, fields)
    expect(r.ok).toBe(false)
  })

  it('flags tags multi-value op holding only blank entries', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'tags', operator: 'has_all_of', value: ['', '  '] })
    const r = validateTreeForApply(t, fields)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].messageKey).toBe('ui.advancedFilter.error.missingValue')
  })

  it('flags tags multi-value op holding a plain string instead of an array', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'tags', operator: 'has_none_of', value: 'vip' })
    expect(validateTreeForApply(t, fields).ok).toBe(false)
  })

  it.each(['has_any_of', 'has_all_of', 'has_none_of'] as const)('accepts %s on a tags field with an array value', (operator) => {
    const t = tree({ id: 'a', type: 'rule', field: 'tags', operator, value: ['vip', 'eu'] })
    expect(validateTreeForApply(t, fields)).toEqual({ ok: true })
  })

  it('flags between op with one endpoint missing', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'created_at', operator: 'between', value: ['2026-01-01', ''] })
    const r = validateTreeForApply(t, fields)
    expect(r.ok).toBe(false)
  })

  it('walks nested groups and reports errors from sub-groups', () => {
    const t = tree(
      { id: 'a', type: 'rule', field: 'name', operator: 'contains', value: 'okay' },
      { id: 'g1', type: 'group', combinator: 'or', children: [
        { id: 'b', type: 'rule', field: 'name', operator: 'contains', value: '' },
      ] },
    )
    const r = validateTreeForApply(t, fields)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map(e => e.ruleId)).toEqual(['b'])
  })

  it('allows non-blank one-character substring text operators', () => {
    const t = tree({ id: 'a', type: 'rule', field: 'name', operator: 'contains', value: 'a' })
    expect(validateTreeForApply(t, fields)).toEqual({ ok: true })
  })

  it('allows all non-blank substring operators regardless of length', () => {
    for (const op of ['contains', 'does_not_contain', 'starts_with', 'ends_with'] as const) {
      const short = tree({ id: 'a', type: 'rule', field: 'name', operator: op, value: 'ab' })
      expect(validateTreeForApply(short, fields)).toEqual({ ok: true })
    }
  })
})
