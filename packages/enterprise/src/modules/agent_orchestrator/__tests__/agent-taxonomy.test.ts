/**
 * Agent taxonomy (spec `.ai/specs/enterprise/agent-orchestrator/2026-08-11-agent-taxonomy.md`,
 * Phase 3, steps 8 + 9).
 *
 * Two claims are load-bearing here:
 *
 * 1. `agentType` is an AUTHORING declaration carried from `defineAgent` onto the registry
 *    entry, so an agent can be listed, filtered and asserted on BEFORE it has run.
 * 2. `allowedActions` NARROWS and never widens. An entry naming something the platform
 *    catalogue does not declare is DROPPED at registration and warned — silently keeping
 *    it would read to whoever authored it as a granted permission.
 */

// Keep the cross-module aggregator and the file-agent manifest out of the registry so
// only the agents this file declares are in play.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

import { z } from 'zod'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { defineAgent, ensureAgentsLoaded, getAgentEntry } from '../lib/sdk/defineAgent'
import { agentTypeSchema } from '../data/validators'
import { isEffectWithinVocabulary, loadActionVocabulary } from '../lib/runtime/actionVocabulary'
import { executeProposal } from '../lib/runtime/executeProposal'
import { captureLogs } from './support/captureLogs'

const SAFE_COMMAND = 'customers.deals.update'
const OUT_OF_CATALOGUE = 'billing.refunds.issue'

const researcherSchema = z.object({ kind: z.literal('researcher'), data: z.unknown() })

describe('agentTypeSchema', () => {
  it('is the three declared types and nothing else', () => {
    expect(agentTypeSchema.options).toEqual(['researcher', 'decision_maker', 'action'])
    expect(agentTypeSchema.safeParse('informative').success).toBe(false)
    expect(agentTypeSchema.safeParse('actionable').success).toBe(false)
  })
})

describe('agent registration', () => {
  // `ensureAgentsLoaded` memoizes its load, so the narrowing pass — and its warning —
  // happen exactly once. Capture around that one call rather than per test.
  let loadLogs: ReturnType<typeof captureLogs>

  beforeAll(async () => {
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([
      { commandId: SAFE_COMMAND, requiredFeatures: ['customers.deals.edit'] },
    ])

    defineAgent({
      id: 'taxonomy.decider',
      moduleId: 'agent_orchestrator',
      label: 'Decider',
      description: 'Declares a type and a narrowed vocabulary.',
      instructions: 'x',
      agentType: 'decision_maker',
      allowedActions: [SAFE_COMMAND, OUT_OF_CATALOGUE],
      result: { kind: 'researcher', schema: researcherSchema },
    })
    defineAgent({
      id: 'taxonomy.untyped',
      moduleId: 'agent_orchestrator',
      label: 'Untyped',
      description: 'Declares neither, as every agent did before this spec.',
      instructions: 'x',
      result: { kind: 'researcher', schema: researcherSchema },
    })

    loadLogs = captureLogs()
    await ensureAgentsLoaded()
    loadLogs.restore()
  })

  it('carries the declared agentType onto the registry entry', () => {
    expect(getAgentEntry('taxonomy.decider')?.agentType).toBe('decision_maker')
  })

  it('leaves an agent that declares neither untyped and unnarrowed', () => {
    const entry = getAgentEntry('taxonomy.untyped')
    expect(entry?.agentType).toBeUndefined()
    // `undefined` — NOT `[]`. An empty list denies everything; declaring nothing means
    // "bounded by the catalogue alone", which is what every pre-existing agent was.
    expect(entry?.allowedActions).toBeUndefined()
  })

  it('drops an allowedActions entry outside the catalogue and warns about it', () => {
    expect(getAgentEntry('taxonomy.decider')?.allowedActions).toEqual([SAFE_COMMAND])

    const dropWarning = loadLogs
      .at('warn')
      .find((record) => record.fields.agentId === 'taxonomy.decider')
    expect(dropWarning).toBeDefined()
    expect(dropWarning?.fields.dropped).toEqual([OUT_OF_CATALOGUE])
  })
})

describe('the narrowed vocabulary is re-checked before the effect', () => {
  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([
      { commandId: SAFE_COMMAND, requiredFeatures: ['customers.deals.edit'] },
    ])
  })

  it('rejects a catalogue action the agent was not narrowed to', async () => {
    const vocabulary = await loadActionVocabulary()
    // In the catalogue, so the catalogue check alone would pass it…
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND)).toBe(true)
    // …but the agent's own list does not name it.
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND, ['SEND_EMAIL'])).toBe(false)
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND, [SAFE_COMMAND])).toBe(true)
  })

  it('an EMPTY narrowing denies every action rather than meaning "no narrowing"', async () => {
    const vocabulary = await loadActionVocabulary()
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND, [])).toBe(false)
  })

  it('executeProposal skips an action outside the agent narrowing', async () => {
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
    const results = await executeProposal([{ type: 'set_stage', payload: { stage: 'won' } }], {
      commandBus: { execute } as never,
      commandCtx: {} as never,
      actionCommandMap: { set_stage: SAFE_COMMAND },
      allowedActions: ['SEND_EMAIL'],
    })

    expect(execute).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('outside the effective action vocabulary'),
    })
  })
})
