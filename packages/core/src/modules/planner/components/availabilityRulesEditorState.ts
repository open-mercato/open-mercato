export type AvailabilityRuleSetOption = {
  id: string
}

export function resolveRuleSetSelectValue(
  ruleSets: AvailabilityRuleSetOption[],
  selectedRulesetId: string | null | undefined,
): string | undefined {
  if (!selectedRulesetId) return undefined
  return ruleSets.some((ruleSet) => ruleSet.id === selectedRulesetId) ? selectedRulesetId : undefined
}
