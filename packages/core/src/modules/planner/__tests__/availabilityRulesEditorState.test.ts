import {
  requiresResetConfirmation,
  resolveRuleSetSelectValue,
  selectCustomRuleIdsToDelete,
} from '../components/availabilityRulesEditorState'

describe('availabilityRulesEditorState', () => {
  it('returns undefined when the selected ruleset is not loaded', () => {
    expect(resolveRuleSetSelectValue([{ id: 'schedule-1' }], 'schedule-2')).toBeUndefined()
  })

  it('returns the selected ruleset id when it exists in the options', () => {
    expect(resolveRuleSetSelectValue([{ id: 'schedule-1' }, { id: 'schedule-2' }], 'schedule-2')).toBe('schedule-2')
  })

  describe('selectCustomRuleIdsToDelete', () => {
    it('preserves all custom hours when switching schedules (#2325)', () => {
      const rules = [{ id: 'rule-1' }, { id: 'rule-2' }]
      expect(selectCustomRuleIdsToDelete('switch', rules)).toEqual([])
    })

    it('returns every custom rule id when resetting to the schedule', () => {
      const rules = [{ id: 'rule-1' }, { id: 'rule-2' }]
      expect(selectCustomRuleIdsToDelete('reset', rules)).toEqual(['rule-1', 'rule-2'])
    })

    it('deduplicates rule ids when resetting', () => {
      const rules = [{ id: 'rule-1' }, { id: 'rule-1' }, { id: 'rule-2' }]
      expect(selectCustomRuleIdsToDelete('reset', rules)).toEqual(['rule-1', 'rule-2'])
    })

    it('returns no ids for either transition when there are no custom rules', () => {
      expect(selectCustomRuleIdsToDelete('switch', [])).toEqual([])
      expect(selectCustomRuleIdsToDelete('reset', [])).toEqual([])
    })
  })

  describe('requiresResetConfirmation', () => {
    it('requires confirmation when custom hours exist', () => {
      expect(requiresResetConfirmation([{ id: 'rule-1' }])).toBe(true)
    })

    it('skips confirmation when there is nothing to delete', () => {
      expect(requiresResetConfirmation([])).toBe(false)
    })
  })
})
