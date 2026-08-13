/**
 * `listAgentOutcomeContracts()` carries the OUT-OF-BAND flag (tracker task 4.4).
 *
 * This method is the ONLY server-side seam from core's workflows module to this
 * optional peer. T4.2's authoring guard — "an agent that answers out of band
 * cannot sit inside a parallel branch" — could therefore only run in the
 * browser, where the agents REST endpoint already serves `runtime` per item. The
 * definitions API, the `validate_workflow_definition` tool and the in-Studio
 * draft agent all evaluate a definition on the SERVER, so the AI author could
 * write the mistake and nothing would say so until a human opened the canvas.
 *
 * `suspends` is what closes that. It names the PROPERTY rather than the runtime:
 * core only needs to know the answer arrives later, so a future runtime that
 * also parks is covered without core learning another of this module's runtime
 * names.
 */

// Keep the cross-module aggregator and the file-agent manifest out of the
// registry so only the agents this file declares are in play.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { defineAgent } from '../lib/sdk/defineAgent'
import { defineExternalAgent } from '../lib/sdk/defineExternalAgent'
import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'

const outcome = z.object({ reached: z.boolean(), transcript: z.string() })
const envelope = z.object({ kind: z.literal('researcher'), data: outcome })

function bridge(): AgentWorkflowBridgeService {
  return new AgentWorkflowBridgeService({
    container: { resolve: () => undefined } as unknown as AwilixContainer,
    agentRuntime: {} as never,
    dispositionService: {} as never,
  })
}

describe('listAgentOutcomeContracts() out-of-band flag', () => {
  beforeAll(() => {
    defineExternalAgent({
      id: 'suspends.voice_caller',
      moduleId: 'voice_agents',
      label: 'Call the business owner',
      description: '',
      connectorId: 'test.voice',
      result: { kind: 'researcher', schema: envelope },
      timeout: '30m',
    })
    defineAgent({
      id: 'suspends.native_researcher',
      moduleId: 'voice_agents',
      label: 'Enrich in process',
      description: '',
      instructions: 'Answer.',
      result: { kind: 'researcher', schema: envelope },
    })
  })

  it('stamps suspends: true for an external agent', async () => {
    const contracts = await bridge().listAgentOutcomeContracts()
    const external = contracts.find((item) => item.agentId === 'suspends.voice_caller')

    expect(external).toBeDefined()
    expect(external?.suspends).toBe(true)
    // Everything the projection carried before is untouched — this field is
    // purely additive and the ledger reads the same contract it always did.
    expect(external?.resultKind).toBe('researcher')
    expect(external?.schema.safeParse({ reached: true, transcript: 'hi' }).success).toBe(true)
  })

  it('stamps suspends: false for an agent that answers in process', async () => {
    const contracts = await bridge().listAgentOutcomeContracts()
    const native = contracts.find((item) => item.agentId === 'suspends.native_researcher')

    expect(native).toBeDefined()
    expect(native?.suspends).toBe(false)
  })

  it('reports the flag for EVERY projected agent, so an absent flag means an older bridge', async () => {
    const contracts = await bridge().listAgentOutcomeContracts()
    expect(contracts.length).toBeGreaterThan(0)
    for (const contract of contracts) {
      expect(typeof contract.suspends).toBe('boolean')
    }
  })
})
