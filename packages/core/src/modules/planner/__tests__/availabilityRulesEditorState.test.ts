import { resolveRuleSetSelectValue } from '../components/availabilityRulesEditorState'

describe('availabilityRulesEditorState', () => {
  it('returns undefined when the selected ruleset is not loaded', () => {
    expect(resolveRuleSetSelectValue([{ id: 'schedule-1' }], 'schedule-2')).toBeUndefined()
  })

  it('returns the selected ruleset id when it exists in the options', () => {
    expect(resolveRuleSetSelectValue([{ id: 'schedule-1' }, { id: 'schedule-2' }], 'schedule-2')).toBe('schedule-2')
  })
})
