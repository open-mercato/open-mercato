import {
  type AdvancedFilterTree,
  type FilterRule,
  type FilterGroup,
  type FilterCombinator,
  validateTreeLimits,
  TREE_LIMITS,
} from '@open-mercato/shared/lib/query/advanced-filter-tree'

export type TreeAction =
  | { type: 'addRule'; groupId: string; defaultField?: string }
  | { type: 'addGroup'; groupId: string; defaultField?: string }
  | { type: 'removeNode'; nodeId: string }
  | { type: 'updateRule'; ruleId: string; updates: Partial<Pick<FilterRule, 'field' | 'operator' | 'value'>> }
  | { type: 'updateGroupCombinator'; groupId: string; combinator: FilterCombinator }

function emptyRule(defaultField?: string): FilterRule {
  return {
    id: crypto.randomUUID(),
    type: 'rule',
    field: defaultField ?? '',
    operator: 'contains',
    value: '',
  }
}

function emptyGroup(defaultField?: string): FilterGroup {
  return {
    id: crypto.randomUUID(),
    type: 'group',
    combinator: 'and',
    children: [emptyRule(defaultField)],
  }
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
  // Deep clone so React detects state change.
  const next: AdvancedFilterTree = JSON.parse(JSON.stringify(state))
  let mutated = false

  function apply(group: FilterGroup): boolean {
    switch (action.type) {
      case 'addRule':
        if (group.id === action.groupId) {
          group.children.push(emptyRule(action.defaultField))
          return true
        }
        break
      case 'addGroup':
        if (group.id === action.groupId) {
          group.children.push(emptyGroup(action.defaultField))
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
