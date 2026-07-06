import { deleteAvailabilityRuleSet, type DeleteAvailabilityRuleSetActions } from '../lib/deleteAvailabilityRuleSet'

function buildActions(overrides: Partial<DeleteAvailabilityRuleSetActions> = {}): {
  actions: DeleteAvailabilityRuleSetActions
  calls: string[]
} {
  const calls: string[] = []
  const actions: DeleteAvailabilityRuleSetActions = {
    ruleSetId: 'rs-1',
    confirmDelete: async () => {
      calls.push('confirm')
      return true
    },
    deleteRuleSet: async (ruleSetId) => {
      calls.push(`delete:${ruleSetId}`)
    },
    clearAssignment: async () => {
      calls.push('clear')
    },
    refreshRuleSets: async () => {
      calls.push('refresh')
    },
    onSuccess: () => {
      calls.push('success')
    },
    onError: () => {
      calls.push('error')
    },
    ...overrides,
  }
  return { actions, calls }
}

describe('deleteAvailabilityRuleSet', () => {
  it('deletes, clears the assignment, refreshes and reports success in order', async () => {
    const { actions, calls } = buildActions()
    const outcome = await deleteAvailabilityRuleSet(actions)
    expect(outcome).toBe('deleted')
    expect(calls).toEqual(['confirm', 'delete:rs-1', 'clear', 'refresh', 'success'])
  })

  it('does nothing when no schedule is selected', async () => {
    const { actions, calls } = buildActions({ ruleSetId: null })
    const outcome = await deleteAvailabilityRuleSet(actions)
    expect(outcome).toBe('noop')
    expect(calls).toEqual([])
  })

  it('stops without deleting when the confirmation is declined', async () => {
    const { actions, calls } = buildActions({ confirmDelete: async () => false })
    const outcome = await deleteAvailabilityRuleSet(actions)
    expect(outcome).toBe('cancelled')
    expect(calls).toEqual([])
  })

  it('reports failure without clearing the assignment when deletion fails', async () => {
    const failure = new Error('boom')
    const { actions, calls } = buildActions({
      deleteRuleSet: async () => {
        throw failure
      },
    })
    let received: unknown
    actions.onError = (error) => {
      received = error
      calls.push('error')
    }
    const outcome = await deleteAvailabilityRuleSet(actions)
    expect(outcome).toBe('failed')
    expect(received).toBe(failure)
    expect(calls).toEqual(['confirm', 'error'])
  })
})
