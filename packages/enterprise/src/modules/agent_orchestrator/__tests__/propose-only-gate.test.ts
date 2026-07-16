// Propose-only generation gate (contract C8): a file agent that declares a tool
// registered with `isMutation: true` MUST be rejected at load time — it never
// registers. We enforce at load time (not in the CLI generator) because the CLI
// cannot import core's runtime tool registry. This test mocks the generated
// manifest + the AI tool registry to prove a mutation-tool-declaring file agent
// is skipped while a read-only one registers.

const getToolMock = jest.fn()

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader', () => ({
  loadAllModuleTools: () => Promise.resolve(),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTool: (id: string) => getToolMock(id) }),
}))

// Prevent the cross-module aggregator from populating the registry (we want only
// our two file agents in play). loadAgentRegistry throws → fallback to the
// module's own ai-agents.ts; that still leaves room for our file agents.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))

const readOnlySchema = {
  type: 'object',
  required: ['data'],
  properties: { data: { type: 'string', minLength: 1 } },
} as const

jest.mock('../generated/file-agents.generated', () => ({
  fileAgentDescriptors: [
    {
      id: 'gate.read_only_agent',
      moduleId: 'agent_examples',
      label: 'Read only',
      description: 'declares a read tool',
      instructions: 'x',
      resultKind: 'informative',
      outcomeSchema: readOnlySchema,
      tools: ['customers.get_deal'],
      skills: [],
      subAgents: [],
      openCodeAgentName: 'gate_read_only_agent',
    },
    {
      id: 'gate.mutation_agent',
      moduleId: 'agent_examples',
      label: 'Mutation',
      description: 'declares a write tool',
      instructions: 'x',
      resultKind: 'informative',
      outcomeSchema: readOnlySchema,
      tools: ['customers.update_deal'],
      skills: [],
      subAgents: [],
      openCodeAgentName: 'gate_mutation_agent',
    },
  ],
}))

import { ensureAgentsLoaded, getAgentEntry } from '../lib/sdk/defineAgent'

describe('propose-only generation gate (file agents)', () => {
  beforeAll(() => {
    getToolMock.mockImplementation((id: string) => {
      if (id === 'customers.update_deal') return { isMutation: true }
      if (id === 'customers.get_deal') return { isMutation: false }
      return undefined
    })
  })

  it('rejects a file agent that declares a mutation tool and registers the read-only one', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureAgentsLoaded()

    expect(getAgentEntry('gate.read_only_agent')).toBeDefined()
    expect(getAgentEntry('gate.mutation_agent')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('gate.mutation_agent'),
    )
    warn.mockRestore()
  })
})
