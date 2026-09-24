import type { AdvancedFilterTree, FilterGroup, FilterRule } from '@open-mercato/shared/lib/query/advanced-filter-tree'

// The filter panel sends date-only values (`YYYY-MM-DD`) while `created_at` is a
// timestamp. Compiled as-is, `is 2026-09-01` becomes `= 2026-09-01 00:00` and matches
// nothing, and `between A and B` drops everything created during day B. These rules
// are rewritten so a date-only value always stands for the whole calendar day. The
// end-of-day bound carries no zone suffix, so it is read in the same zone as the
// date-only start bound.

const CREATED_AT_FIELD = 'created_at'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())
}

function endOfDay(value: string): string {
  return `${value.trim()}T23:59:59.999`
}

function expandRule(rule: FilterRule): FilterRule {
  if (rule.field !== CREATED_AT_FIELD) return rule
  switch (rule.operator) {
    case 'is':
    case 'equals':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, operator: 'between', value: [rule.value.trim(), endOfDay(rule.value)] }
    case 'is_after':
    case 'greater_than':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, operator: 'greater_than', value: endOfDay(rule.value) }
    case 'less_or_equal':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, value: endOfDay(rule.value) }
    case 'between': {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return rule
      const [start, end] = rule.value
      if (!isDateOnly(end)) return rule
      return { ...rule, value: [start, endOfDay(end)] }
    }
    default:
      return rule
  }
}

function expandGroup(group: FilterGroup): FilterGroup {
  return {
    ...group,
    children: group.children.map((child) => (child.type === 'group' ? expandGroup(child) : expandRule(child))),
  }
}

export function expandCreatedAtDayRules(tree: AdvancedFilterTree | null): AdvancedFilterTree | null {
  if (!tree) return tree
  return { ...tree, root: expandGroup(tree.root) }
}
