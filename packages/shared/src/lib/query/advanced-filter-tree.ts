// packages/shared/src/lib/query/advanced-filter-tree.ts
import type { FilterOperator } from './advanced-filter'
import { isValuelessOperator } from './advanced-filter'
import { escapeLikePattern } from '../db/escapeLikePattern'

export type FilterCombinator = 'and' | 'or'

export type FilterRule = {
  id: string
  type: 'rule'
  field: string
  operator: FilterOperator
  value: unknown
}

export type FilterGroup = {
  id: string
  type: 'group'
  combinator: FilterCombinator
  children: Array<FilterRule | FilterGroup>
}

export type AdvancedFilterTree = {
  root: FilterGroup
}

export const TREE_LIMITS = {
  maxGroupLevel: 3,        // root = level 1; deepest nested group = level 3
  maxChildrenPerGroup: 15, // counts both rules and nested groups
  maxTotalRules: 50,
} as const

export function createEmptyTree(): AdvancedFilterTree {
  return {
    root: {
      id: crypto.randomUUID(),
      type: 'group',
      combinator: 'and',
      children: [],
    },
  }
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'depth' | 'width' | 'total' }

export function validateTreeLimits(tree: AdvancedFilterTree): ValidationResult {
  let totalRules = 0
  function walk(node: FilterRule | FilterGroup, level: number): ValidationResult {
    if (node.type === 'rule') {
      totalRules += 1
      return { ok: true }
    }
    if (level > TREE_LIMITS.maxGroupLevel) return { ok: false, reason: 'depth' }
    if (node.children.length > TREE_LIMITS.maxChildrenPerGroup) return { ok: false, reason: 'width' }
    for (const child of node.children) {
      const r = walk(child, level + 1)
      if (!r.ok) return r
    }
    return { ok: true }
  }
  const r = walk(tree.root, 1)
  if (!r.ok) return r
  if (totalRules > TREE_LIMITS.maxTotalRules) return { ok: false, reason: 'total' }
  return { ok: true }
}

function normalizeSingleValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeListValue(value: unknown): unknown[] {
  const list = Array.isArray(value) ? value : [value]
  return list.map(normalizeSingleValue).filter((v) => v !== null)
}

function compileRule(rule: FilterRule): Record<string, unknown> | null {
  if (!rule.field || !rule.operator) return null
  const filter: Record<string, unknown> = {}
  switch (rule.operator) {
    case 'is':
    case 'equals': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $eq: v }; break
    }
    case 'is_not':
    case 'not_equals': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $ne: v }; break
    }
    case 'contains': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $ilike: `%${escapeLikePattern(String(v))}%` }; break
    }
    case 'does_not_contain': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $not: { $ilike: `%${escapeLikePattern(String(v))}%` } }; break
    }
    case 'starts_with': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $ilike: `${escapeLikePattern(String(v))}%` }; break
    }
    case 'ends_with': {
      const v = normalizeSingleValue(rule.value)
      if (v === null) return null
      filter[rule.field] = { $ilike: `%${escapeLikePattern(String(v))}` }; break
    }
    case 'is_empty': filter[rule.field] = { $exists: false }; break
    case 'is_not_empty': filter[rule.field] = { $exists: true }; break
    case 'greater_than': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $gt: v }; break }
    case 'less_than': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $lt: v }; break }
    case 'greater_or_equal': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $gte: v }; break }
    case 'less_or_equal': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $lte: v }; break }
    case 'between': {
      if (Array.isArray(rule.value) && rule.value.length === 2) {
        const start = normalizeSingleValue(rule.value[0])
        const end = normalizeSingleValue(rule.value[1])
        if (start === null && end === null) return null
        if (start !== null && end !== null) filter[rule.field] = { $gte: start, $lte: end }
        else if (start !== null) filter[rule.field] = { $gte: start }
        else filter[rule.field] = { $lte: end }
      } else {
        return null
      }
      break
    }
    case 'is_before': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $lt: v }; break }
    case 'is_after': { const v = normalizeSingleValue(rule.value); if (v === null) return null; filter[rule.field] = { $gt: v }; break }
    case 'is_any_of':
    case 'has_any_of': {
      const list = normalizeListValue(rule.value)
      if (list.length === 0) return null
      filter[rule.field] = { $in: list }; break
    }
    case 'is_none_of':
    case 'has_none_of': {
      const list = normalizeListValue(rule.value)
      if (list.length === 0) return null
      filter[rule.field] = { $nin: list }; break
    }
    case 'has_all_of': {
      const list = normalizeListValue(rule.value)
      if (list.length === 0) return null
      filter[rule.field] = { $contains: list }; break
    }
    case 'is_true': filter[rule.field] = { $eq: true }; break
    case 'is_false': filter[rule.field] = { $eq: false }; break
  }
  return Object.keys(filter).length > 0 ? filter : null
}

export function compileTreeToWhere(tree: AdvancedFilterTree): Record<string, unknown> | null {
  return compileGroup(tree.root)
}

function compileGroup(node: FilterGroup): Record<string, unknown> | null {
  const compiled = node.children
    .map((child) => (child.type === 'rule' ? compileRule(child) : compileGroup(child)))
    .filter((c): c is Record<string, unknown> => c !== null)
  if (compiled.length === 0) return null
  if (compiled.length === 1) return compiled[0]
  return node.combinator === 'or' ? { $or: compiled } : { $and: compiled }
}

// Re-export isValuelessOperator so consumers of this module can access it
export { isValuelessOperator }
