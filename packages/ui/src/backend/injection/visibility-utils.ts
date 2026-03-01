import type { FieldContext, FieldVisibilityCondition, FieldVisibilityRule } from '@open-mercato/shared/modules/widgets/injection'

export function evaluateVisibilityRule(rule: FieldVisibilityRule, formData: Record<string, unknown>): boolean {
  const current = formData[rule.field]
  switch (rule.operator) {
    case 'eq':
      return current === rule.value
    case 'neq':
      return current !== rule.value
    case 'in':
      return Array.isArray(rule.value) ? rule.value.includes(current) : false
    case 'notIn':
      return Array.isArray(rule.value) ? !rule.value.includes(current) : true
    case 'truthy':
      return Boolean(current)
    case 'falsy':
      return !current
    default:
      return true
  }
}

export function evaluateInjectedVisibility(
  condition: FieldVisibilityCondition | undefined,
  values: Record<string, unknown>,
  context: FieldContext,
): boolean {
  if (!condition) return true
  if (typeof condition === 'function') return condition(values, context)
  return evaluateVisibilityRule(condition, values)
}
