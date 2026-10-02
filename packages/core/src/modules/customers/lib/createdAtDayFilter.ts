import { fromZonedTime } from 'date-fns-tz'
import type { AdvancedFilterTree, FilterGroup, FilterRule } from '@open-mercato/shared/lib/query/advanced-filter-tree'

// The filter panel sends date-only values (`YYYY-MM-DD`) while `created_at` is a
// timestamp. A date-only value names a calendar day, and a calendar day only has
// bounds in a given time zone, so every date-only `created_at` rule is rewritten to
// explicit instants for that zone. The list pages pass the reader's zone — the same
// zone `toLocaleDateString()` uses to render the Created column — so what the column
// shows and what the filter matches agree. The list APIs pass UTC for callers that
// still send bare dates, so the result never depends on the database session zone.

const CREATED_AT_FIELD = 'created_at'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())
}

function startOfDay(value: string, timeZone: string): string {
  return fromZonedTime(`${value.trim()}T00:00:00.000`, timeZone).toISOString()
}

function endOfDay(value: string, timeZone: string): string {
  return fromZonedTime(`${value.trim()}T23:59:59.999`, timeZone).toISOString()
}

function expandRule(rule: FilterRule, timeZone: string): FilterRule {
  if (rule.field !== CREATED_AT_FIELD) return rule
  switch (rule.operator) {
    case 'is':
    case 'equals':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, operator: 'between', value: [startOfDay(rule.value, timeZone), endOfDay(rule.value, timeZone)] }
    case 'is_after':
    case 'greater_than':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, operator: 'greater_than', value: endOfDay(rule.value, timeZone) }
    case 'less_or_equal':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, value: endOfDay(rule.value, timeZone) }
    case 'is_before':
    case 'less_than':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, operator: 'less_than', value: startOfDay(rule.value, timeZone) }
    case 'greater_or_equal':
      if (!isDateOnly(rule.value)) return rule
      return { ...rule, value: startOfDay(rule.value, timeZone) }
    case 'between': {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return rule
      const [start, end] = rule.value
      return {
        ...rule,
        value: [
          isDateOnly(start) ? startOfDay(start, timeZone) : start,
          isDateOnly(end) ? endOfDay(end, timeZone) : end,
        ],
      }
    }
    default:
      return rule
  }
}

function expandGroup(group: FilterGroup, timeZone: string): FilterGroup {
  return {
    ...group,
    children: group.children.map((child) =>
      child.type === 'group' ? expandGroup(child, timeZone) : expandRule(child, timeZone),
    ),
  }
}

export function expandCreatedAtDayRules<T extends AdvancedFilterTree | null>(tree: T, timeZone: string): T {
  if (!tree) return tree
  return { ...tree, root: expandGroup(tree.root, timeZone) } as T
}
