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
  // Runtime-only metadata used by the editor reducer (e.g. removeLast) to find
  // the most recently inserted node. MUST NOT be serialized into URL or persisted state.
  addedAt?: number
}

export type FilterGroup = {
  id: string
  type: 'group'
  combinator: FilterCombinator
  children: Array<FilterRule | FilterGroup>
  // Runtime-only metadata used by the editor reducer (e.g. removeLast) to find
  // the most recently inserted node. MUST NOT be serialized into URL or persisted state.
  addedAt?: number
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

/**
 * Build a single-rule tree wrapped in an AND root group.
 * Useful for quick-filter presets that apply one rule.
 */
export function makeRuleTree(rule: { field: string; operator: FilterOperator; value: unknown }): AdvancedFilterTree {
  const ruleNode: FilterRule = {
    id: crypto.randomUUID(),
    type: 'rule',
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
  }
  return {
    root: {
      id: crypto.randomUUID(),
      type: 'group',
      combinator: 'and',
      children: [ruleNode],
    },
  }
}

/**
 * Persisted shape of an `AdvancedFilterTree` inside `PerspectiveSettings.filters`.
 * The `v: 2` marker disambiguates the tree from legacy flat `FilterValues` and
 * from the plain `{root: ...}` shape. Runtime-only `addedAt` is stripped before
 * persisting so saved perspectives are deterministic across reloads.
 */
export type PersistedFilterTree = {
  v: 2
  root: FilterGroup
}

function stripRuntimeMetadataDeep<T extends FilterRule | FilterGroup>(node: T): T {
  if (node.type === 'rule') {
    const { addedAt: _ignored, ...rest } = node as FilterRule & { addedAt?: number }
    return rest as T
  }
  const { addedAt: _ignored, children, ...rest } = node as FilterGroup & { addedAt?: number }
  const cleanChildren = children.map((c) => stripRuntimeMetadataDeep(c))
  return { ...rest, children: cleanChildren } as T
}

/** Serialize a tree for persistence (perspective settings, exports, etc.). */
export function serializeTreeForPersist(tree: AdvancedFilterTree): PersistedFilterTree {
  return { v: 2, root: stripRuntimeMetadataDeep(tree.root) }
}

/** Type guard: does `value` look like a persisted filter tree? */
export function isPersistedFilterTree(value: unknown): value is PersistedFilterTree {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.v !== 2) return false
  const root = record.root
  if (!root || typeof root !== 'object') return false
  const r = root as Record<string, unknown>
  return r.type === 'group' && (r.combinator === 'and' || r.combinator === 'or') && Array.isArray(r.children)
}

/**
 * Restore a tree from its persisted shape. Returns `null` when the input is
 * not a recognizable persisted tree — callers should fall back to legacy
 * filter handling in that case.
 */
export function deserializeTreeFromPersist(value: unknown): AdvancedFilterTree | null {
  if (!isPersistedFilterTree(value)) return null
  return { root: value.root }
}

/**
 * Best-effort back-conversion of a tree to the legacy flat `AdvancedFilterState`
 * shape (`{logic, conditions[]}`). The flat shape only supports a single level
 * of AND/OR joining between sibling conditions; nested groups are flattened by
 * walking all leaf rules into the top level. Use this only for the legacy
 * `DataTable.advancedFilter` BC bridge — new code should keep the tree shape.
 *
 * The function picks `logic` from the root group's combinator and uses each
 * rule's parent-group combinator as its `join`. The first rule's `join` is
 * always `'and'` (it has no left neighbor).
 */
export function treeToFlat(tree: AdvancedFilterTree): {
  logic: 'and' | 'or'
  conditions: Array<{
    id: string
    field: string
    operator: import('./advanced-filter').FilterOperator
    value: unknown
    join: 'and' | 'or'
  }>
} {
  const conditions: Array<{
    id: string
    field: string
    operator: import('./advanced-filter').FilterOperator
    value: unknown
    join: 'and' | 'or'
  }> = []

  function walk(group: FilterGroup, parentJoin: 'and' | 'or') {
    for (const child of group.children) {
      if (child.type === 'rule') {
        conditions.push({
          id: child.id,
          field: child.field,
          operator: child.operator,
          value: child.value,
          // First rule overall gets 'and' (it has no left neighbor); the rest
          // inherit the parent group's combinator.
          join: conditions.length === 0 ? 'and' : parentJoin,
        })
      } else {
        walk(child, child.combinator)
      }
    }
  }
  walk(tree.root, tree.root.combinator)

  return { logic: tree.root.combinator, conditions }
}

/**
 * Build a multi-rule tree wrapped in a root group with the given combinator.
 * Useful for quick-filter presets that combine multiple rules (e.g.
 * `status is win AND close_date is_after start_of_quarter`).
 */
export function makeMultiRuleTree(
  rules: Array<{ field: string; operator: FilterOperator; value: unknown }>,
  combinator: FilterCombinator = 'and',
): AdvancedFilterTree {
  return {
    root: {
      id: crypto.randomUUID(),
      type: 'group',
      combinator,
      children: rules.map((rule) => {
        const node: FilterRule = {
          id: crypto.randomUUID(),
          type: 'rule',
          field: rule.field,
          operator: rule.operator,
          value: rule.value,
        }
        return node
      }),
    },
  }
}
