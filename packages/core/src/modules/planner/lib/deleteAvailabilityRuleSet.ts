export type DeleteAvailabilityRuleSetOutcome = 'deleted' | 'cancelled' | 'noop' | 'failed'

export type DeleteAvailabilityRuleSetActions = {
  ruleSetId: string | null | undefined
  confirmDelete: () => Promise<boolean>
  deleteRuleSet: (ruleSetId: string) => Promise<void>
  clearAssignment: () => Promise<void>
  refreshRuleSets: () => Promise<void>
  onSuccess: () => void
  onError: (error: unknown) => void
}

/**
 * Orchestrates deleting an availability schedule (rule set) from the availability
 * editor: confirm, delete the schedule, clear it from the current subject so no
 * dangling assignment remains, refresh the selector, and report the outcome.
 */
export async function deleteAvailabilityRuleSet(
  actions: DeleteAvailabilityRuleSetActions,
): Promise<DeleteAvailabilityRuleSetOutcome> {
  const ruleSetId = actions.ruleSetId
  if (!ruleSetId) return 'noop'
  const confirmed = await actions.confirmDelete()
  if (!confirmed) return 'cancelled'
  try {
    await actions.deleteRuleSet(ruleSetId)
    await actions.clearAssignment()
    await actions.refreshRuleSets()
    actions.onSuccess()
    return 'deleted'
  } catch (error) {
    actions.onError(error)
    return 'failed'
  }
}
