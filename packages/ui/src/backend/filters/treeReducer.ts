import {
  type AdvancedFilterTree,
  type FilterRule,
  type FilterGroup,
  type FilterCombinator,
  validateTreeLimits,
  TREE_LIMITS,
} from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterOperator } from '@open-mercato/shared/lib/query/advanced-filter'

export type TreeAction =
  | { type: 'addRule'; groupId: string; defaultField?: string; defaultOperator?: FilterOperator }
  | { type: 'addGroup'; groupId: string; defaultField?: string; defaultOperator?: FilterOperator }
  | { type: 'removeNode'; nodeId: string }
  | { type: 'updateRule'; ruleId: string; updates: Partial<Pick<FilterRule, 'field' | 'operator' | 'value'>> }
  | { type: 'updateGroupCombinator'; groupId: string; combinator: FilterCombinator }
  | { type: 'reorderChildren'; groupId: string; fromIdx: number; toIdx: number }
  | { type: 'removeLast' }
  | { type: 'replaceRoot'; root: FilterGroup }

// Pure monotonic counter for tracking insert order within a session.
// MUST NOT be mixed with wall-clock time — that leaks load timing into tests
// (fixture ordering depended on `Date.now()` resolution across runs).
// Runtime-only — never serialized.
let addedAtCounter = 0
function nextAddedAt(): number {
  addedAtCounter += 1
  return addedAtCounter
}

function emptyRule(defaultField?: string, defaultOperator?: FilterOperator): FilterRule {
  return {
    id: crypto.randomUUID(),
    type: 'rule',
    field: defaultField ?? '',
    operator: defaultOperator ?? 'contains',
    value: '',
    addedAt: nextAddedAt(),
  }
}

function emptyGroup(defaultField?: string, defaultOperator?: FilterOperator): FilterGroup {
  return {
    id: crypto.randomUUID(),
    type: 'group',
    combinator: 'and',
    children: [emptyRule(defaultField, defaultOperator)],
    addedAt: nextAddedAt(),
  }
}

type WithAddedAt = { addedAt?: number }

function findMaxAddedAtNode(
  group: FilterGroup,
): { parent: FilterGroup; idx: number; addedAt: number } | null {
  let best: { parent: FilterGroup; idx: number; addedAt: number } | null = null
  function walk(g: FilterGroup) {
    g.children.forEach((c, idx) => {
      const a = (c as unknown as WithAddedAt).addedAt
      if (typeof a === 'number') {
        if (!best || a > best.addedAt) best = { parent: g, idx, addedAt: a }
      }
      if (c.type === 'group') walk(c)
    })
  }
  walk(group)
  return best
}

function findGroupAndDepth(root: FilterGroup, id: string, depth = 1): { group: FilterGroup; depth: number } | null {
  if (root.id === id) return { group: root, depth }
  for (const child of root.children) {
    if (child.type === 'group') {
      const r = findGroupAndDepth(child, id, depth + 1)
      if (r) return r
    }
  }
  return null
}

function countRules(group: FilterGroup): number {
  let n = 0
  for (const c of group.children) {
    if (c.type === 'rule') n += 1
    else n += countRules(c)
  }
  return n
}

export function treeReducer(state: AdvancedFilterTree, action: TreeAction): AdvancedFilterTree {
  // replaceRoot bypasses cloning/walking — it overwrites the entire root.
  if (action.type === 'replaceRoot') {
    const next: AdvancedFilterTree = { root: action.root }
    const v = validateTreeLimits(next)
    return v.ok ? next : state
  }

  // Deep clone so React detects state change. The tree is JSON-safe so JSON
  // round-tripping is sufficient; the Jest jsdom env doesn't expose
  // `structuredClone`, so avoid relying on it.
  const next: AdvancedFilterTree = JSON.parse(JSON.stringify(state))

  if (action.type === 'removeLast') {
    const found = findMaxAddedAtNode(next.root)
    if (!found) return state
    found.parent.children.splice(found.idx, 1)
    const v = validateTreeLimits(next)
    return v.ok ? next : state
  }

  let mutated = false

  function apply(group: FilterGroup): boolean {
    switch (action.type) {
      case 'addRule':
        if (group.id === action.groupId) {
          group.children.push(emptyRule(action.defaultField, action.defaultOperator))
          return true
        }
        break
      case 'addGroup':
        if (group.id === action.groupId) {
          group.children.push(emptyGroup(action.defaultField, action.defaultOperator))
          return true
        }
        break
      case 'updateGroupCombinator':
        if (group.id === action.groupId) {
          group.combinator = action.combinator
          return true
        }
        break
      case 'removeNode': {
        const idx = group.children.findIndex((c) => c.id === action.nodeId)
        if (idx >= 0) {
          group.children.splice(idx, 1)
          return true
        }
        break
      }
      case 'updateRule':
        for (const c of group.children) {
          if (c.type === 'rule' && c.id === action.ruleId) {
            Object.assign(c, action.updates)
            return true
          }
        }
        break
      case 'reorderChildren':
        if (group.id === action.groupId) {
          const arr = group.children
          if (
            action.fromIdx >= 0 &&
            action.fromIdx < arr.length &&
            action.toIdx >= 0 &&
            action.toIdx < arr.length &&
            action.fromIdx !== action.toIdx
          ) {
            const [moved] = arr.splice(action.fromIdx, 1)
            arr.splice(action.toIdx, 0, moved)
            return true
          }
        }
        break
    }
    for (const c of group.children) {
      if (c.type === 'group' && apply(c)) return true
    }
    return false
  }

  mutated = apply(next.root)
  if (!mutated) return state

  const v = validateTreeLimits(next)
  if (!v.ok) return state // reject by returning original (caller can show a tooltip)
  return next
}

export function canAddRule(tree: AdvancedFilterTree, groupId: string): boolean {
  const found = findGroupAndDepth(tree.root, groupId)
  if (!found) return false
  if (found.group.children.length >= TREE_LIMITS.maxChildrenPerGroup) return false
  if (countRules(tree.root) >= TREE_LIMITS.maxTotalRules) return false
  return true
}

export function canAddGroup(tree: AdvancedFilterTree, groupId: string): boolean {
  const found = findGroupAndDepth(tree.root, groupId)
  if (!found) return false
  if (found.group.children.length >= TREE_LIMITS.maxChildrenPerGroup) return false
  if (found.depth >= TREE_LIMITS.maxGroupLevel) return false
  if (countRules(tree.root) >= TREE_LIMITS.maxTotalRules) return false
  return true
}

export function getGroupDepth(tree: AdvancedFilterTree, groupId: string): number | null {
  const found = findGroupAndDepth(tree.root, groupId)
  return found?.depth ?? null
}
