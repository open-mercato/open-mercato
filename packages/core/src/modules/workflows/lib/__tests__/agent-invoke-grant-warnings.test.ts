import {
  AGENT_INVOKE_NOT_COVERED_WARNING,
  collectAgentInvokeGrantWarnings,
  collectInvokeAgentReferences,
  findAgentInvokeGrantWarnings,
} from '../agent-invoke-grant-warnings'

const definition = {
  steps: [
    { stepId: 'start', stepType: 'START' },
    {
      stepId: 'assess',
      stepType: 'AUTOMATED',
      activities: [
        { activityId: 'invoke_health', activityType: 'INVOKE_AGENT', config: { agentId: 'sales.deal_health' } },
      ],
    },
    {
      stepId: 'enrich',
      stepType: 'AUTOMATED',
      activities: [
        { activityId: 'invoke_open', activityType: 'INVOKE_AGENT', config: { agentId: 'catalog.enricher' } },
      ],
    },
    { stepId: 'end', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 't_review',
      fromStepId: 'assess',
      toStepId: 'end',
      activities: [
        { activityId: 'invoke_review', activityType: 'INVOKE_AGENT', config: { agentId: 'sales.deal_health' } },
      ],
    },
  ],
}

const requirements = [
  { agentId: 'sales.deal_health', requiredFeatures: ['sales.deals.view', 'sales.deals.health'] },
  { agentId: 'catalog.enricher', requiredFeatures: [] },
]

function containerWithBridge(bridge: unknown) {
  return {
    resolve: <T,>(name: string): T => {
      if (name !== 'agentWorkflowBridge' || bridge === undefined) {
        throw new Error(`[internal] ${name} not registered`)
      }
      return bridge as T
    },
  }
}

describe('collectInvokeAgentReferences', () => {
  it('finds INVOKE_AGENT activities on steps and transitions', () => {
    expect(collectInvokeAgentReferences(definition)).toEqual([
      { stepId: 'assess', agentId: 'sales.deal_health' },
      { stepId: 'enrich', agentId: 'catalog.enricher' },
      { stepId: 't_review', agentId: 'sales.deal_health' },
    ])
  })

  it('ignores malformed input and activities without an agent id', () => {
    expect(collectInvokeAgentReferences(null)).toEqual([])
    expect(
      collectInvokeAgentReferences({
        steps: [{ stepId: 'x', activities: [{ activityType: 'INVOKE_AGENT', config: { agentId: '  ' } }] }],
      }),
    ).toEqual([])
  })
})

describe('findAgentInvokeGrantWarnings', () => {
  it('returns no warning when the grant covers the agent features', () => {
    expect(findAgentInvokeGrantWarnings(definition, ['sales.deals.*'], requirements)).toEqual([])
  })

  it('warns per step whose agent the grant does not cover, without naming features', () => {
    const warnings = findAgentInvokeGrantWarnings(definition, ['sales.deals.view'], requirements)
    expect(warnings).toEqual([
      { code: AGENT_INVOKE_NOT_COVERED_WARNING, stepId: 'assess', agentId: 'sales.deal_health' },
      { code: AGENT_INVOKE_NOT_COVERED_WARNING, stepId: 't_review', agentId: 'sales.deal_health' },
    ])
    expect(JSON.stringify(warnings)).not.toContain('sales.deals.health')
  })

  it('returns no warning when the definition declares no grant', () => {
    expect(findAgentInvokeGrantWarnings(definition, null, requirements)).toEqual([])
    expect(findAgentInvokeGrantWarnings(definition, [], requirements)).toEqual([])
  })

  it('returns no warning for agents unknown to the bridge', () => {
    expect(findAgentInvokeGrantWarnings(definition, ['other.feature'], [])).toEqual([])
  })
})

describe('collectAgentInvokeGrantWarnings', () => {
  it('reads requirements from the optional bridge', async () => {
    const listAgentAccessRequirements = jest.fn(async () => requirements)
    const warnings = await collectAgentInvokeGrantWarnings(containerWithBridge({ listAgentAccessRequirements }), {
      definition,
      grantedFeatures: ['catalog.products.view'],
    })
    expect(listAgentAccessRequirements).toHaveBeenCalledTimes(1)
    expect(warnings.map((warning) => warning.stepId)).toEqual(['assess', 't_review'])
  })

  it('does not consult the bridge when the definition declares no grant', async () => {
    const listAgentAccessRequirements = jest.fn(async () => requirements)
    const warnings = await collectAgentInvokeGrantWarnings(containerWithBridge({ listAgentAccessRequirements }), {
      definition,
      grantedFeatures: null,
    })
    expect(warnings).toEqual([])
    expect(listAgentAccessRequirements).not.toHaveBeenCalled()
  })

  it('returns no warnings when the bridge is absent', async () => {
    await expect(
      collectAgentInvokeGrantWarnings(containerWithBridge(undefined), {
        definition,
        grantedFeatures: ['catalog.products.view'],
      }),
    ).resolves.toEqual([])
  })

  it('returns no warnings when the bridge predates the requirements method', async () => {
    await expect(
      collectAgentInvokeGrantWarnings(containerWithBridge({ listAgentOutcomeContracts: async () => [] }), {
        definition,
        grantedFeatures: ['catalog.products.view'],
      }),
    ).resolves.toEqual([])
  })

  it('fails soft when the bridge lookup throws', async () => {
    const listAgentAccessRequirements = jest.fn(async () => {
      throw new Error('[internal] registry unavailable')
    })
    await expect(
      collectAgentInvokeGrantWarnings(containerWithBridge({ listAgentAccessRequirements }), {
        definition,
        grantedFeatures: ['catalog.products.view'],
      }),
    ).resolves.toEqual([])
  })

  it('accepts a synchronous bridge implementation', async () => {
    const warnings = await collectAgentInvokeGrantWarnings(
      containerWithBridge({ listAgentAccessRequirements: () => requirements }),
      { definition, grantedFeatures: ['catalog.products.view'] },
    )
    expect(warnings).toHaveLength(2)
  })
})
