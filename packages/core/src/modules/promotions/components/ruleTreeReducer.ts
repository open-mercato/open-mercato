// Tree mutation reducer for the Rule Group Tree Builder (Step 1.7). Mirrors the
// recursive deep-clone-and-walk shape of `packages/ui/src/backend/filters/treeReducer.ts`
// (the closest existing precedent in this repo for an editable AND/OR tree), adapted to
// this module's three-array-per-group shape (`rules`/`benefits`/`children`) rather than
// `AdvancedFilterBuilder`'s single `children` array, since `RuleGroup`/`Rule`/`Benefit`
// are three distinct entity kinds here (§Data Models), not one polymorphic node type.

import {
  BENEFIT_APPLIES_TO,
  buildDefaultBenefitConfig,
  buildDefaultRuleConfig,
  createEmptyBenefit,
  createEmptyGroup,
  createEmptyRule,
  type BenefitTypeId,
  type LocalBenefitNode,
  type LocalRuleGroupNode,
  type LocalRuleNode,
  type RuleTypeId,
} from './ruleTreeTypes'

export type TreeAction =
  | { type: 'addRule'; groupId: string }
  | { type: 'addBenefit'; groupId: string }
  | { type: 'addSubgroup'; groupId: string }
  | { type: 'removeRule'; ruleId: string }
  | { type: 'removeBenefit'; benefitId: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'duplicateGroup'; groupId: string }
  | { type: 'setGroupOperator'; groupId: string; operator: 'and' | 'or' }
  // Resets `config` to the new type's default — "selecting a new rule type resets that
  // rule's data fields" (SPEC-055 §UI/UX Rule Group Tree Builder).
  | { type: 'setRuleType'; ruleId: string; ruleType: RuleTypeId }
  | { type: 'setRuleConfig'; ruleId: string; config: Record<string, unknown> }
  | { type: 'setBenefitType'; benefitId: string; benefitType: BenefitTypeId }
  // `config` is supplied by the caller already cleared of fields the new `appliesTo`
  // makes unreachable (see `components/benefitLimits.ts` `applyAppliesToChange`).
  | { type: 'setBenefitAppliesTo'; benefitId: string; appliesTo: LocalBenefitNode['appliesTo']; config: Record<string, unknown> }
  | { type: 'setBenefitConfig'; benefitId: string; config: Record<string, unknown> }
  | { type: 'setBenefitLabels'; benefitId: string; labels: Record<string, string> }
  | { type: 'reorderRules'; groupId: string; fromIndex: number; toIndex: number }
  | { type: 'reorderBenefits'; groupId: string; fromIndex: number; toIndex: number }
  | { type: 'reorderChildren'; parentGroupId: string; fromIndex: number; toIndex: number }

function reindex<T>(items: T[]): T[] {
  return items
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return reindex(next)
}

// Walks the tree depth-first, applying `visit` to every group. `visit` returns `true`
// once it has performed the mutation, which stops the walk early.
function walkGroups(group: LocalRuleGroupNode, visit: (group: LocalRuleGroupNode) => boolean): boolean {
  if (visit(group)) return true
  for (const child of group.children) {
    if (walkGroups(child, visit)) return true
  }
  return false
}

function findAndRemove<T extends { clientId: string }>(
  group: LocalRuleGroupNode,
  listKey: 'rules' | 'benefits',
  id: string,
): boolean {
  return walkGroups(group, (node) => {
    const list = node[listKey] as unknown as T[]
    const index = list.findIndex((item) => item.clientId === id)
    if (index === -1) return false
    list.splice(index, 1)
    return true
  })
}

function findRule(group: LocalRuleGroupNode, ruleId: string): LocalRuleNode | null {
  let found: LocalRuleNode | null = null
  walkGroups(group, (node) => {
    const match = node.rules.find((rule) => rule.clientId === ruleId)
    if (match) {
      found = match
      return true
    }
    return false
  })
  return found
}

function findBenefit(group: LocalRuleGroupNode, benefitId: string): LocalBenefitNode | null {
  let found: LocalBenefitNode | null = null
  walkGroups(group, (node) => {
    const match = node.benefits.find((benefit) => benefit.clientId === benefitId)
    if (match) {
      found = match
      return true
    }
    return false
  })
  return found
}

function findGroup(root: LocalRuleGroupNode, groupId: string): LocalRuleGroupNode | null {
  let found: LocalRuleGroupNode | null = null
  walkGroups(root, (node) => {
    if (node.clientId === groupId) {
      found = node
      return true
    }
    return false
  })
  return found
}

// Removes a group (and, by structural sharing of the recursion below, its own
// descendants) from wherever it lives as a child. Returns the removed group so a
// duplicate action can clone it.
function removeGroupById(root: LocalRuleGroupNode, groupId: string): LocalRuleGroupNode | null {
  let removed: LocalRuleGroupNode | null = null
  walkGroups(root, (node) => {
    const index = node.children.findIndex((child) => child.clientId === groupId)
    if (index === -1) return false
    removed = node.children[index]
    node.children.splice(index, 1)
    return true
  })
  return removed
}

function cloneGroupAsNew(group: LocalRuleGroupNode): LocalRuleGroupNode {
  const next = createEmptyGroup(group.sortOrder, group.operator)
  next.rules = group.rules.map((rule) => ({ ...createEmptyRule(rule.sortOrder, rule.ruleType), config: { ...rule.config } }))
  next.benefits = group.benefits.map((benefit) => ({
    ...createEmptyBenefit(benefit.sortOrder, benefit.benefitType),
    appliesTo: benefit.appliesTo,
    config: { ...benefit.config },
    labels: { ...benefit.labels },
  }))
  next.children = group.children.map((child) => cloneGroupAsNew(child))
  return next
}

export function ruleTreeReducer(root: LocalRuleGroupNode, action: TreeAction): LocalRuleGroupNode {
  // Deep clone so React detects the state change, mirroring
  // `packages/ui/src/backend/filters/treeReducer.ts`'s own approach — the tree is a
  // plain JSON-safe structure (no functions/class instances), so a JSON round trip is a
  // safe and simple way to clone it.
  const next: LocalRuleGroupNode = JSON.parse(JSON.stringify(root))

  switch (action.type) {
    case 'addRule': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.rules.push(createEmptyRule(group.rules.length))
      return next
    }
    case 'addBenefit': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.benefits.push(createEmptyBenefit(group.benefits.length))
      return next
    }
    case 'addSubgroup': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.children.push(createEmptyGroup(group.children.length))
      return next
    }
    case 'removeRule': {
      const removed = findAndRemove<LocalRuleNode>(next, 'rules', action.ruleId)
      return removed ? next : root
    }
    case 'removeBenefit': {
      const removed = findAndRemove<LocalBenefitNode>(next, 'benefits', action.benefitId)
      return removed ? next : root
    }
    case 'removeGroup': {
      if (next.clientId === action.groupId) return root // never remove the root
      const removed = removeGroupById(next, action.groupId)
      return removed ? next : root
    }
    case 'duplicateGroup': {
      if (next.clientId === action.groupId) return root
      let duplicated = false
      walkGroups(next, (node) => {
        const index = node.children.findIndex((child) => child.clientId === action.groupId)
        if (index === -1) return false
        const clone = cloneGroupAsNew(node.children[index])
        node.children.splice(index + 1, 0, clone)
        duplicated = true
        return true
      })
      return duplicated ? next : root
    }
    case 'setGroupOperator': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.operator = action.operator
      return next
    }
    case 'setRuleType': {
      const rule = findRule(next, action.ruleId)
      if (!rule) return root
      rule.ruleType = action.ruleType
      rule.config = buildDefaultRuleConfig(action.ruleType)
      return next
    }
    case 'setRuleConfig': {
      const rule = findRule(next, action.ruleId)
      if (!rule) return root
      rule.config = action.config
      return next
    }
    case 'setBenefitType': {
      const benefit = findBenefit(next, action.benefitId)
      if (!benefit) return root
      benefit.benefitType = action.benefitType
      // The allowed "Applies to" set changes per benefit type (§Data Models "Allowed
      // values per applies_to per benefit_type") — reset to the new type's default
      // alongside `config` so a stale value from the previous type can never persist
      // outside its own allow-list.
      benefit.appliesTo = BENEFIT_APPLIES_TO[action.benefitType].default
      benefit.config = buildDefaultBenefitConfig(action.benefitType)
      return next
    }
    case 'setBenefitAppliesTo': {
      const benefit = findBenefit(next, action.benefitId)
      if (!benefit) return root
      benefit.appliesTo = action.appliesTo
      benefit.config = action.config
      return next
    }
    case 'setBenefitConfig': {
      const benefit = findBenefit(next, action.benefitId)
      if (!benefit) return root
      benefit.config = action.config
      return next
    }
    case 'setBenefitLabels': {
      const benefit = findBenefit(next, action.benefitId)
      if (!benefit) return root
      benefit.labels = action.labels
      return next
    }
    case 'reorderRules': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.rules = moveItem(group.rules, action.fromIndex, action.toIndex)
      return next
    }
    case 'reorderBenefits': {
      const group = findGroup(next, action.groupId)
      if (!group) return root
      group.benefits = moveItem(group.benefits, action.fromIndex, action.toIndex)
      return next
    }
    case 'reorderChildren': {
      const group = findGroup(next, action.parentGroupId)
      if (!group) return root
      group.children = moveItem(group.children, action.fromIndex, action.toIndex)
      return next
    }
    default:
      return root
  }
}
