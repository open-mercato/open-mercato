import { escapeLikePattern } from '../db/escapeLikePattern'

export type FilterOperator =
  | 'is' | 'is_not' | 'contains' | 'does_not_contain' | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty'
  | 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'greater_or_equal' | 'less_or_equal' | 'between'
  | 'is_before' | 'is_after'
  | 'is_any_of' | 'is_none_of'
  | 'is_true' | 'is_false'
  | 'has_any_of' | 'has_all_of' | 'has_none_of'

export type FilterFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'tags'

export type FilterOption = {
  value: string
  label: string
}

export type FilterFieldDef = {
  key: string
  label: string
  type: FilterFieldType
  group?: string
  loadOptions?: (query?: string) => Promise<FilterOption[]>
  options?: FilterOption[]
}

export type FilterJoinOperator = 'and' | 'or'

export type FilterCondition = {
  id: string
  field: string
  operator: FilterOperator
  value: unknown
  join?: FilterJoinOperator
}

export type AdvancedFilterState = {
  logic: FilterJoinOperator
  conditions: FilterCondition[]
}

export const OPERATORS_BY_FIELD_TYPE: Record<FilterFieldType, FilterOperator[]> = {
  text: ['is', 'is_not', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'between', 'is_empty'],
  date: ['is', 'is_before', 'is_after', 'between', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_any_of', 'is_none_of', 'is_empty'],
  boolean: ['is_true', 'is_false'],
  tags: ['has_any_of', 'has_all_of', 'has_none_of', 'is_empty'],
}

export function getDefaultOperator(fieldType: FilterFieldType): FilterOperator {
  switch (fieldType) {
    case 'text': return 'contains'
    case 'number': return 'equals'
    case 'date': return 'is_after'
    case 'select': return 'is'
    case 'boolean': return 'is_true'
    case 'tags': return 'has_any_of'
  }
}

const VALID_OPERATORS = new Set<string>([
  'is', 'is_not', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
  'equals', 'not_equals', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'between',
  'is_before', 'is_after',
  'is_any_of', 'is_none_of',
  'is_true', 'is_false',
  'has_any_of', 'has_all_of', 'has_none_of',
])

export function isValidOperator(op: string): op is FilterOperator {
  return VALID_OPERATORS.has(op)
}

export function isValuelessOperator(operator: FilterOperator): boolean {
  return operator === 'is_empty' || operator === 'is_not_empty' || operator === 'is_true' || operator === 'is_false'
}

export function createEmptyCondition(): FilterCondition {
  return {
    id: crypto.randomUUID(),
    field: '',
    operator: 'contains',
    value: '',
    join: 'and',
  }
}

function normalizeJoinOperator(value: unknown, fallback: FilterJoinOperator = 'and'): FilterJoinOperator {
  return value === 'or' ? 'or' : value === 'and' ? 'and' : fallback
}

function parseSerializedFilterValue(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

export function normalizeAdvancedFilterState(state: AdvancedFilterState): AdvancedFilterState {
  const logic = normalizeJoinOperator(state.logic)
  return {
    logic,
    conditions: state.conditions.map((condition, index) => ({
      ...condition,
      join: index === 0 ? 'and' : normalizeJoinOperator(condition.join, logic),
    })),
  }
}

export function serializeAdvancedFilter(state: AdvancedFilterState): Record<string, string> {
  const params: Record<string, string> = {}
  const normalized = normalizeAdvancedFilterState(state)
  if (!normalized.conditions.length) return params
  params['filter[logic]'] = normalized.logic
  normalized.conditions.forEach((condition, index) => {
    const prefix = `filter[conditions][${index}]`
    params[`${prefix}[field]`] = condition.field
    params[`${prefix}[op]`] = condition.operator
    if (index > 0) {
      params[`${prefix}[join]`] = condition.join ?? normalized.logic
    }
    if (!isValuelessOperator(condition.operator) && condition.value != null) {
      params[`${prefix}[value]`] = typeof condition.value === 'object'
        ? JSON.stringify(condition.value)
        : String(condition.value)
    }
  })
  return params
}

export function deserializeAdvancedFilter(query: Record<string, unknown>): AdvancedFilterState | null {
  const logic = normalizeJoinOperator(query['filter[logic]'])
  const conditions: FilterCondition[] = []
  for (let i = 0; i < 20; i++) {
    const field = query[`filter[conditions][${i}][field]`]
    const op = query[`filter[conditions][${i}][op]`]
    if (typeof field !== 'string' || typeof op !== 'string') break
    if (!isValidOperator(op)) continue
    const value = query[`filter[conditions][${i}][value]`]
    const join = i === 0
      ? 'and'
      : normalizeJoinOperator(query[`filter[conditions][${i}][join]`], logic)
    conditions.push({
      id: String(i),
      field,
      operator: op,
      value: parseSerializedFilterValue(value),
      join,
    })
  }

  if (!conditions.length) return null
  return normalizeAdvancedFilterState({ logic, conditions })
}

function buildConditionFilter(condition: FilterCondition): Record<string, unknown> | null {
  if (!condition.field || !condition.operator) return null
  const normalizeSingleValue = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  const normalizeListValue = (value: unknown): unknown[] => {
    const list = Array.isArray(value) ? value : [value]
    return list
      .map((entry) => normalizeSingleValue(entry))
      .filter((entry) => entry !== null)
  }
  const filter: Record<string, unknown> = {}
  switch (condition.operator) {
    case 'is':
    case 'equals':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $eq: normalizeSingleValue(condition.value) }
      break
    case 'is_not':
    case 'not_equals':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $ne: normalizeSingleValue(condition.value) }
      break
    case 'contains':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $ilike: `%${escapeLikePattern(String(normalizeSingleValue(condition.value)))}%` }
      break
    case 'does_not_contain':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $not: { $ilike: `%${escapeLikePattern(String(normalizeSingleValue(condition.value)))}%` } }
      break
    case 'starts_with':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $ilike: `${escapeLikePattern(String(normalizeSingleValue(condition.value)))}%` }
      break
    case 'ends_with':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $ilike: `%${escapeLikePattern(String(normalizeSingleValue(condition.value)))}` }
      break
    case 'is_empty':
      filter[condition.field] = { $exists: false }
      break
    case 'is_not_empty':
      filter[condition.field] = { $exists: true }
      break
    case 'greater_than':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $gt: normalizeSingleValue(condition.value) }
      break
    case 'less_than':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $lt: normalizeSingleValue(condition.value) }
      break
    case 'greater_or_equal':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $gte: normalizeSingleValue(condition.value) }
      break
    case 'less_or_equal':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $lte: normalizeSingleValue(condition.value) }
      break
    case 'between':
      if (Array.isArray(condition.value) && condition.value.length === 2) {
        const start = normalizeSingleValue(condition.value[0])
        const end = normalizeSingleValue(condition.value[1])
        if (start === null && end === null) return null
        if (start !== null && end !== null) {
          filter[condition.field] = { $gte: start, $lte: end }
        } else if (start !== null) {
          filter[condition.field] = { $gte: start }
        } else if (end !== null) {
          filter[condition.field] = { $lte: end }
        }
      }
      break
    case 'is_before':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $lt: normalizeSingleValue(condition.value) }
      break
    case 'is_after':
      if (normalizeSingleValue(condition.value) === null) return null
      filter[condition.field] = { $gt: normalizeSingleValue(condition.value) }
      break
    case 'is_any_of':
    case 'has_any_of':
      if (normalizeListValue(condition.value).length === 0) return null
      filter[condition.field] = { $in: normalizeListValue(condition.value) }
      break
    case 'is_none_of':
    case 'has_none_of':
      if (normalizeListValue(condition.value).length === 0) return null
      filter[condition.field] = { $nin: normalizeListValue(condition.value) }
      break
    case 'has_all_of': {
      const allOfValues = normalizeListValue(condition.value)
      if (allOfValues.length === 0) return null
      filter[condition.field] = { $contains: allOfValues }
      break
    }
    case 'is_true':
      filter[condition.field] = { $eq: true }
      break
    case 'is_false':
      filter[condition.field] = { $eq: false }
      break
  }
  return Object.keys(filter).length > 0 ? filter : null
}

export function convertAdvancedFilterToWhere(state: AdvancedFilterState): Record<string, unknown> {
  const normalized = normalizeAdvancedFilterState(state)
  if (!normalized.conditions.length) return {}

  const conditionEntries = normalized.conditions
    .map((condition) => {
      const filter = buildConditionFilter(condition)
      return filter
        ? {
            join: normalizeJoinOperator(condition.join, normalized.logic),
            filter,
          }
        : null
    })
    .filter((entry): entry is { join: FilterJoinOperator; filter: Record<string, unknown> } => entry !== null)

  if (!conditionEntries.length) return {}

  let clauses: Record<string, unknown>[] = [conditionEntries[0].filter]
  for (const entry of conditionEntries.slice(1)) {
    if (entry.join === 'or') {
      clauses = [...clauses, entry.filter]
      continue
    }
    clauses = clauses.map((clause) => ({
      ...clause,
      ...entry.filter,
    }))
  }

  return clauses.length > 1 ? { $or: clauses } : clauses[0]
}

// -----------------------------------------------------------------------------
// v2 tree serialization (advanced-filter-tree)
// -----------------------------------------------------------------------------

import type {
  AdvancedFilterTree,
  FilterRule as TreeFilterRule,
  FilterGroup as TreeFilterGroup,
  FilterCombinator as TreeFilterCombinator,
} from './advanced-filter-tree'

export function serializeTree(tree: AdvancedFilterTree): Record<string, string> {
  const out: Record<string, string> = { 'filter[v]': '2' }
  serializeTreeGroup(tree.root, 'filter[root]', out)
  return out
}

function serializeTreeGroup(group: TreeFilterGroup, prefix: string, out: Record<string, string>): void {
  out[`${prefix}[combinator]`] = group.combinator
  group.children.forEach((child, idx) => {
    const childPrefix = `${prefix}[children][${idx}]`
    if (child.type === 'rule') serializeTreeRule(child, childPrefix, out)
    else { out[`${childPrefix}[type]`] = 'group'; serializeTreeGroup(child, childPrefix, out) }
  })
}

function serializeTreeRule(rule: TreeFilterRule, prefix: string, out: Record<string, string>): void {
  out[`${prefix}[type]`] = 'rule'
  out[`${prefix}[field]`] = rule.field
  out[`${prefix}[op]`] = rule.operator
  if (!isValuelessOperator(rule.operator) && rule.value != null) {
    out[`${prefix}[value]`] = typeof rule.value === 'object'
      ? JSON.stringify(rule.value)
      : String(rule.value)
  }
}

export function deserializeTree(query: Record<string, unknown>): AdvancedFilterTree | null {
  if (query['filter[v]'] !== '2') return null
  const root = readTreeGroup('filter[root]', query)
  if (!root) return null
  return { root }
}

function readTreeGroup(prefix: string, query: Record<string, unknown>): TreeFilterGroup | null {
  const combRaw = query[`${prefix}[combinator]`]
  if (combRaw !== 'and' && combRaw !== 'or') return null
  const children: Array<TreeFilterRule | TreeFilterGroup> = []
  for (let i = 0; i < 64; i++) {
    const childPrefix = `${prefix}[children][${i}]`
    const type = query[`${childPrefix}[type]`]
    if (type === 'rule') {
      const field = query[`${childPrefix}[field]`]
      const op = query[`${childPrefix}[op]`]
      if (typeof field !== 'string' || typeof op !== 'string' || !isValidOperator(op)) continue
      const rawVal = query[`${childPrefix}[value]`]
      children.push({
        id: crypto.randomUUID(),
        type: 'rule',
        field,
        operator: op as FilterOperator,
        value: parseSerializedFilterValue(rawVal),
      })
    } else if (type === 'group') {
      const sub = readTreeGroup(childPrefix, query)
      if (sub) children.push(sub)
    } else {
      break
    }
  }
  return {
    id: crypto.randomUUID(),
    type: 'group',
    combinator: combRaw as TreeFilterCombinator,
    children,
  }
}

/**
 * Convert legacy flat AdvancedFilterState into a tree under standard SQL precedence
 * (AND binds tighter than OR). Runs of consecutive AND-joined conditions become
 * AND-subgroups, and the OR connectors join those subgroups in a root OR-group.
 */
export function flatToTree(flat: AdvancedFilterState): AdvancedFilterTree {
  if (flat.conditions.length === 0) {
    return { root: { id: crypto.randomUUID(), type: 'group', combinator: 'and', children: [] } }
  }

  // Step A: split into AND-runs separated by OR connectors. The first row's `join`
  // is logically "and" (no left neighbor); we never use it as a separator.
  const andRuns: FilterCondition[][] = [[flat.conditions[0]]]
  for (let i = 1; i < flat.conditions.length; i++) {
    const c = flat.conditions[i]
    if (c.join === 'or') andRuns.push([c])
    else andRuns[andRuns.length - 1].push(c)
  }

  const ruleFromCondition = (c: FilterCondition): TreeFilterRule => ({
    id: crypto.randomUUID(),
    type: 'rule',
    field: c.field,
    operator: c.operator,
    value: c.value,
  })

  // Step B: each AND-run becomes either a rule (length 1) or an AND-group.
  const orChildren: Array<TreeFilterRule | TreeFilterGroup> = andRuns.map((run) => {
    if (run.length === 1) return ruleFromCondition(run[0])
    return {
      id: crypto.randomUUID(),
      type: 'group',
      combinator: 'and',
      children: run.map(ruleFromCondition),
    }
  })

  // Step C: zero or one OR-disjunct -> root combinator stays "and"; otherwise OR.
  if (orChildren.length === 1) {
    const only = orChildren[0]
    if (only.type === 'group') return { root: only }
    return { root: { id: crypto.randomUUID(), type: 'group', combinator: 'and', children: [only] } }
  }
  return {
    root: { id: crypto.randomUUID(), type: 'group', combinator: 'or', children: orChildren },
  }
}
