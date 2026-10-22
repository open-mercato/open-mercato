import {
  buildRoutingRuleEditDraft,
  rebaseRoutingRuleDialog,
  routingRuleVersion,
  type RoutingRuleDialogState,
  type RoutingRuleSnapshot,
} from '../routingRuleDraft'

const RULE_ID = '55555555-5555-4555-8555-555555555552'
const PROJECT_X = '44444444-4444-4444-8444-444444444441'
const PROJECT_Y = '44444444-4444-4444-8444-444444444442'
const PROJECT_Z = '44444444-4444-4444-8444-444444444443'
const VERSION_X = '2026-05-01T10:00:00.000Z'
const VERSION_Y = '2026-05-01T10:05:00.000Z'

function rule(projectId: string, updatedAt: string | null | undefined): RoutingRuleSnapshot {
  return { id: RULE_ID, categoryValue: 'billing', project: { id: projectId }, updatedAt }
}

describe('routing rule draft snapshot', () => {
  it('captures the displayed values and the version token from the same snapshot', () => {
    expect(buildRoutingRuleEditDraft(rule(PROJECT_X, VERSION_X))).toEqual({
      mode: 'edit',
      ruleId: RULE_ID,
      categoryValue: 'billing',
      timeProjectId: PROJECT_X,
      expectedUpdatedAt: VERSION_X,
    })
  })

  it('treats a missing or empty version as no token', () => {
    expect(routingRuleVersion({})).toBeNull()
    expect(routingRuleVersion({ updatedAt: '' })).toBeNull()
    expect(buildRoutingRuleEditDraft(rule(PROJECT_X, undefined))).toEqual(expect.objectContaining({ expectedUpdatedAt: null }))
  })

  it('keeps an open draft and its token when a refresh shows the same rule version', () => {
    const opened = buildRoutingRuleEditDraft(rule(PROJECT_X, VERSION_X))
    const edited: RoutingRuleDialogState = { ...opened, timeProjectId: PROJECT_Z }

    expect(rebaseRoutingRuleDialog(edited, { rules: [rule(PROJECT_X, VERSION_X)] })).toBe(edited)
  })

  it('rebases an open draft onto the refreshed values and token after a concurrent change', () => {
    const opened = buildRoutingRuleEditDraft(rule(PROJECT_X, VERSION_X))
    const edited: RoutingRuleDialogState = { ...opened, timeProjectId: PROJECT_Z }

    const rebased = rebaseRoutingRuleDialog(edited, { rules: [rule(PROJECT_Y, VERSION_Y)] })

    expect(rebased).toEqual({
      mode: 'edit',
      ruleId: RULE_ID,
      categoryValue: 'billing',
      timeProjectId: PROJECT_Y,
      expectedUpdatedAt: VERSION_Y,
    })
  })

  it('never pairs the newer token with the values the user saw before the change', () => {
    const opened = buildRoutingRuleEditDraft(rule(PROJECT_X, VERSION_X))
    const rebased = rebaseRoutingRuleDialog(opened, { rules: [rule(PROJECT_Y, VERSION_Y)] })

    expect(rebased).not.toEqual(expect.objectContaining({ timeProjectId: PROJECT_X, expectedUpdatedAt: VERSION_Y }))
  })

  it('closes the draft when the rule was deleted meanwhile', () => {
    const opened = buildRoutingRuleEditDraft(rule(PROJECT_X, VERSION_X))
    expect(rebaseRoutingRuleDialog(opened, { rules: [] })).toBeNull()
  })

  it('leaves create drafts and a closed dialog untouched', () => {
    const create: RoutingRuleDialogState = { mode: 'create', categoryValue: 'billing', timeProjectId: PROJECT_X }
    expect(rebaseRoutingRuleDialog(create, { rules: [rule(PROJECT_Y, VERSION_Y)] })).toBe(create)
    expect(rebaseRoutingRuleDialog(null, { rules: [rule(PROJECT_Y, VERSION_Y)] })).toBeNull()
  })
})
