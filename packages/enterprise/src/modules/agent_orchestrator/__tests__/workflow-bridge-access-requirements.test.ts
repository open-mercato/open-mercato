/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

const ensureAgentsLoaded = jest.fn(async () => undefined)
const listAgentEntries = jest.fn()

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: () => ensureAgentsLoaded(),
  listAgentEntries: () => listAgentEntries(),
}))

import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'
import type { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import type { DispositionService } from '../lib/disposition/dispositionService'

function buildBridge(): AgentWorkflowBridgeService {
  return new AgentWorkflowBridgeService({
    container: {} as AwilixContainer,
    agentRuntime: {} as AgentRuntimeService,
    dispositionService: {} as DispositionService,
  })
}

describe('AgentWorkflowBridgeService.listAgentAccessRequirements', () => {
  beforeEach(() => {
    ensureAgentsLoaded.mockClear()
    listAgentEntries.mockReset()
  })

  it('projects every registered agent with its required features after loading the registry', async () => {
    listAgentEntries.mockReturnValue([
      { id: 'sales.deal_health', requiredFeatures: ['sales.deals.view', 'sales.deals.health'] },
      { id: 'catalog.enricher' },
    ])

    const requirements = await buildBridge().listAgentAccessRequirements()

    expect(ensureAgentsLoaded).toHaveBeenCalledTimes(1)
    expect(requirements).toEqual([
      { agentId: 'sales.deal_health', requiredFeatures: ['sales.deals.view', 'sales.deals.health'] },
      { agentId: 'catalog.enricher', requiredFeatures: [] },
    ])
  })

  it('returns a copy so callers cannot mutate the registry entry', async () => {
    const features = ['sales.deals.view']
    listAgentEntries.mockReturnValue([{ id: 'sales.deal_health', requiredFeatures: features }])

    const [requirement] = await buildBridge().listAgentAccessRequirements()
    requirement.requiredFeatures.push('extra.feature')

    expect(features).toEqual(['sales.deals.view'])
  })
})
