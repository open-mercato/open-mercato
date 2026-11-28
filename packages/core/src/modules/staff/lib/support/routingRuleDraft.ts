export type RoutingRuleSnapshot = {
  id: string
  categoryValue: string | null
  project: { id: string }
  updatedAt?: string | null
}

export type RoutingRuleSnapshotSet = {
  rules: RoutingRuleSnapshot[]
}

export type RoutingRuleDialogState =
  | { mode: 'create'; categoryValue: string; timeProjectId: string }
  | {
      mode: 'edit'
      ruleId: string
      categoryValue: string
      timeProjectId: string
      expectedUpdatedAt: string | null
    }

export function routingRuleVersion(rule: { updatedAt?: string | null }): string | null {
  return typeof rule.updatedAt === 'string' && rule.updatedAt.length > 0 ? rule.updatedAt : null
}

export function buildRoutingRuleEditDraft(rule: RoutingRuleSnapshot): RoutingRuleDialogState {
  return {
    mode: 'edit',
    ruleId: rule.id,
    categoryValue: rule.categoryValue ?? '',
    timeProjectId: rule.project.id,
    expectedUpdatedAt: routingRuleVersion(rule),
  }
}

export function rebaseRoutingRuleDialog(
  draft: RoutingRuleDialogState | null,
  snapshot: RoutingRuleSnapshotSet,
): RoutingRuleDialogState | null {
  if (!draft || draft.mode === 'create') return draft
  const current = snapshot.rules.find((rule) => rule.id === draft.ruleId)
  if (!current) return null
  if (routingRuleVersion(current) === draft.expectedUpdatedAt) return draft
  return buildRoutingRuleEditDraft(current)
}
