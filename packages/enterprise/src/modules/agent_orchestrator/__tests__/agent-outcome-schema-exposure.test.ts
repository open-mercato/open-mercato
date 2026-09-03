/** @jest-environment node */
import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => {}),
  listAgentEntries: jest.fn(() => []),
}))

const FILE_AGENT_OUTCOME = {
  type: 'object' as const,
  properties: { riskScore: { type: 'number' as const }, summary: { type: 'string' as const } },
  required: ['riskScore'],
}

function entry(overrides: Partial<AgentRegistryEntry>): AgentRegistryEntry {
  return {
    id: 'demo.agent',
    moduleId: 'agent_examples',
    resultKind: 'researcher',
    schema: z.object({ kind: z.literal('researcher'), data: z.object({}) }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Demo',
    description: '',
    instructions: '',
    runtime: 'native',
    ...overrides,
  }
}

async function listAgents(entries: AgentRegistryEntry[]) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { listAgentEntries } = await import('../lib/sdk/defineAgent')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1' })
  ;(listAgentEntries as jest.Mock).mockReturnValue(entries)
  const { GET } = await import('../api/agents/route')
  const response = await GET(new Request('http://localhost/api/agent_orchestrator/agents'))
  const body = (await response.json()) as { items: Array<Record<string, unknown>> }
  return body.items
}

describe('agents API outcome schema exposure', () => {
  it('serves a file agent OUTCOME schema verbatim', async () => {
    const items = await listAgents([
      entry({ id: 'files.risk', runtime: 'opencode', outcomeSchema: FILE_AGENT_OUTCOME }),
    ])
    expect(items[0].outcomeSchema).toEqual(FILE_AGENT_OUTCOME)
  })

  it('derives the OUTCOME schema of an in-process agent from its result envelope', async () => {
    const items = await listAgents([
      entry({
        id: 'deals.health_check',
        resultKind: 'proposal',
        schema: z.object({
          kind: z.literal('proposal'),
          proposal: z.object({ confidence: z.number(), rationale: z.string() }),
        }),
      }),
    ])
    expect(items[0].outcomeSchema).toMatchObject({
      type: 'object',
      properties: { confidence: { type: 'number' }, rationale: { type: 'string' } },
    })
  })

  it('omits the schema when the agent declares no recognizable outcome', async () => {
    const items = await listAgents([entry({ id: 'legacy.agent', schema: z.string() })])
    expect(items[0]).not.toHaveProperty('outcomeSchema')
    expect(items[0].id).toBe('legacy.agent')
  })
})
