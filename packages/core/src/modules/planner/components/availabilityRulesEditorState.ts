export type AvailabilityRuleSetOption = {
  id: string
}

export type AvailabilityRuleRef = {
  id: string
}

export type RuleSetTransition = 'switch' | 'reset'

export function resolveRuleSetSelectValue(
  ruleSets: AvailabilityRuleSetOption[],
  selectedRulesetId: string | null | undefined,
): string | undefined {
  if (!selectedRulesetId) return undefined
  return ruleSets.some((ruleSet) => ruleSet.id === selectedRulesetId) ? selectedRulesetId : undefined
}

// Selects which member-level custom rules to delete for a ruleset transition.
// Switching schedules preserves the member's saved custom hours (#2325): only
// an explicit "Reset to schedule" discards them so the shared schedule applies.
export function selectCustomRuleIdsToDelete(
  transition: RuleSetTransition,
  rules: AvailabilityRuleRef[],
): string[] {
  if (transition === 'switch') return []
  return Array.from(new Set(rules.map((rule) => rule.id)))
}

export function requiresResetConfirmation(rules: AvailabilityRuleRef[]): boolean {
  return rules.length > 0
}
