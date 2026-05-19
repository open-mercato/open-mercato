// packages/ui/src/backend/filters/filterValidation.ts
import type { AdvancedFilterTree, FilterRule, FilterGroup } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import { isValuelessOperator } from '@open-mercato/shared/lib/query/advanced-filter'

export type ValidationError = {
  ruleId: string
  messageKey: string
  message: string
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] }

const MULTI_VALUE_OPS = new Set(['is_any_of', 'is_none_of', 'has_any_of', 'has_all_of', 'has_none_of'])

function isBlank(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  return false
}

function validateRule(rule: FilterRule): ValidationError | null {
  if (isValuelessOperator(rule.operator)) return null
  const op = rule.operator
  if (op === 'between') {
    if (!Array.isArray(rule.value) || rule.value.length !== 2 || isBlank(rule.value[0]) || isBlank(rule.value[1])) {
      return { ruleId: rule.id, messageKey: 'ui.advancedFilter.error.betweenIncomplete', message: 'Pick both endpoints' }
    }
    return null
  }
  if (MULTI_VALUE_OPS.has(op)) {
    if (!Array.isArray(rule.value) || rule.value.length === 0) {
      return { ruleId: rule.id, messageKey: 'ui.advancedFilter.error.missingValue', message: 'Pick at least one value' }
    }
    return null
  }
  if (isBlank(rule.value)) {
    return { ruleId: rule.id, messageKey: 'ui.advancedFilter.error.missingValue', message: 'Pick a value to apply this filter' }
  }
  return null
}

function walkGroup(group: FilterGroup, acc: ValidationError[]): void {
  for (const child of group.children) {
    if (child.type === 'rule') {
      const err = validateRule(child)
      if (err) acc.push(err)
    } else {
      walkGroup(child, acc)
    }
  }
}

export function validateTreeForApply(tree: AdvancedFilterTree, fields: FilterFieldDef[]): ValidationResult {
  void fields
  const errors: ValidationError[] = []
  walkGroup(tree.root, errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
