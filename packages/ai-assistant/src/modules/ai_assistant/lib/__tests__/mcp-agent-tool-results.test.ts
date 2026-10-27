import { z } from 'zod'
import { buildAgentToolOutputSchema } from '../agent-tool'
import {
  advertisedOutputJsonSchema,
  advertisedOutputZodSchema,
  buildToolSuccessResponse,
  filterRunnableAgentTools,
  resolveAgentToolAuditIds,
  toAgentToolCallPayload,
  type McpStructuredResultTool,
} from '../mcp-agent-tool-results'

const mockKnownAgents = new Set<string>()
const mockLoadAgentRegistry = jest.fn(async () => undefined)

jest.mock('../agent-registry', () => ({
  loadAgentRegistry: () => mockLoadAgentRegistry(),
  getAgent: (agentId: string) => (mockKnownAgents.has(agentId) ? { id: agentId } : undefined),
}))

const agentTool: McpStructuredResultTool = {
  name: 'catalog.assistant.run',
  agentRef: { agentId: 'catalog.assistant', engine: 'ai-assistant' },
  mcp: { outputSchema: buildAgentToolOutputSchema(z.object({ summary: z.string() })) },
}

function makeContainer(dispatcher: unknown) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'aiAgentRunDispatcher' && dispatcher) return dispatcher as T
      throw new Error(`[internal] ${name} not registered`)
    },
  }
}

function makeDispatcher(owned: string[], available: boolean | Error) {
  return {
    owns: (agentId: string) => owned.includes(agentId),
    isAvailable: jest.fn(async () => {
      if (available instanceof Error) throw available
      return available
    }),
    runObject: jest.fn(),
  }
}

describe('mcp-agent-tool-results', () => {
  beforeEach(() => {
    mockKnownAgents.clear()
    mockLoadAgentRegistry.mockClear()
  })

  describe('filterRunnableAgentTools', () => {
    const plainTool: McpStructuredResultTool = { name: 'customers.list_people' }
    const orchestratorTool: McpStructuredResultTool = {
      name: 'ops.triage.run',
      agentRef: { agentId: 'ops.triage', engine: 'dispatcher' },
    }

    it('returns the input untouched without loading the registry when no agent tool is present', async () => {
      const tools = [plainTool]
      await expect(filterRunnableAgentTools(tools, makeContainer(null))).resolves.toBe(tools)
      expect(mockLoadAgentRegistry).not.toHaveBeenCalled()
    })

    it('keeps agent tools known to the ai-assistant registry', async () => {
      mockKnownAgents.add('catalog.assistant')
      const result = await filterRunnableAgentTools([plainTool, agentTool], makeContainer(null))
      expect(result.map((tool) => tool.name)).toEqual(['customers.list_people', 'catalog.assistant.run'])
    })

    it('drops agent tools unknown to the registry and not owned by a dispatcher', async () => {
      const result = await filterRunnableAgentTools([plainTool, agentTool, orchestratorTool], makeContainer(null))
      expect(result.map((tool) => tool.name)).toEqual(['customers.list_people'])
    })

    it('keeps a tool whose owning dispatcher reports it available', async () => {
      const dispatcher = makeDispatcher(['ops.triage'], true)
      const result = await filterRunnableAgentTools([orchestratorTool], makeContainer(dispatcher))
      expect(result.map((tool) => tool.name)).toEqual(['ops.triage.run'])
      expect(dispatcher.isAvailable).toHaveBeenCalledWith('ops.triage')
    })

    it('keeps a tool whose agent is not yet in the cold dispatcher registry but is available', async () => {
      const dispatcher = makeDispatcher([], true)
      const result = await filterRunnableAgentTools([orchestratorTool], makeContainer(dispatcher))
      expect(result.map((tool) => tool.name)).toEqual(['ops.triage.run'])
      expect(dispatcher.isAvailable).toHaveBeenCalledWith('ops.triage')
    })

    it('keeps a locally known agent tool without asking a non-owning dispatcher', async () => {
      mockKnownAgents.add('catalog.assistant')
      const dispatcher = makeDispatcher([], false)
      const result = await filterRunnableAgentTools([agentTool], makeContainer(dispatcher))
      expect(result.map((tool) => tool.name)).toEqual(['catalog.assistant.run'])
      expect(dispatcher.isAvailable).not.toHaveBeenCalled()
    })

    it('drops an unknown agent tool when the non-owning dispatcher reports it unavailable', async () => {
      const dispatcher = makeDispatcher([], false)
      const result = await filterRunnableAgentTools([plainTool, orchestratorTool], makeContainer(dispatcher))
      expect(result.map((tool) => tool.name)).toEqual(['customers.list_people'])
    })

    it.each<[string, boolean | Error]>([
      ['reports it unavailable', false],
      ['throws while checking availability', new Error('boom')],
    ])('drops a tool whose owning dispatcher %s', async (_label, available) => {
      mockKnownAgents.add('ops.triage')
      const dispatcher = makeDispatcher(['ops.triage'], available)
      const result = await filterRunnableAgentTools([plainTool, orchestratorTool], makeContainer(dispatcher))
      expect(result.map((tool) => tool.name)).toEqual(['customers.list_people'])
    })
  })

  describe('buildToolSuccessResponse', () => {
    it('returns the agent payload as structuredContent plus a JSON text block', () => {
      const value = { result: { summary: 'ok' }, agentId: 'catalog.assistant', runId: 'run-1', agentRunId: null }
      const response = buildToolSuccessResponse(agentTool, value)
      expect(response.structuredContent).toEqual(value)
      expect(JSON.parse(response.content[0].text)).toEqual(value)
    })

    it('normalizes a partial agent result to the four documented keys', () => {
      expect(toAgentToolCallPayload(agentTool, { result: 1, extra: true })).toEqual({
        result: 1,
        agentId: 'catalog.assistant',
        runId: null,
        agentRunId: null,
      })
    })

    it('keeps non-agent tools without an output schema text-only', () => {
      const response = buildToolSuccessResponse({ name: 'customers.list_people' }, { items: [] })
      expect(response).toEqual({ content: [{ type: 'text', text: JSON.stringify({ items: [] }, null, 2) }] })
    })

    it('adds structuredContent for a non-agent tool that declares an output schema', () => {
      const tool: McpStructuredResultTool = { name: 'catalog.stats', mcp: { outputSchema: z.object({ count: z.number() }) } }
      expect(buildToolSuccessResponse(tool, { count: 3 }).structuredContent).toEqual({ count: 3 })
    })
  })

  describe('advertised output schema', () => {
    it('publishes the agent tool output as a JSON object schema', () => {
      const jsonSchema = advertisedOutputJsonSchema(agentTool)
      expect(jsonSchema).toMatchObject({
        type: 'object',
        properties: { result: expect.any(Object), agentId: expect.any(Object), runId: expect.any(Object) },
      })
    })

    it('builds an SDK schema that accepts the structured agent payload', () => {
      const schema = advertisedOutputZodSchema(agentTool)
      expect(schema).not.toBeNull()
      const payload = { result: { summary: 'ok' }, agentId: 'catalog.assistant', runId: null, agentRunId: 'ao-1' }
      expect(schema?.safeParse(payload).success).toBe(true)
    })

    it('does not advertise an output schema for mutation tools', () => {
      const tool: McpStructuredResultTool = {
        name: 'catalog.update',
        isMutation: true,
        mcp: { outputSchema: z.object({ ok: z.boolean() }) },
      }
      expect(advertisedOutputJsonSchema(tool)).toBeNull()
      expect(advertisedOutputZodSchema(tool)).toBeNull()
    })

    it('returns null for tools without an output schema', () => {
      expect(advertisedOutputJsonSchema({ name: 'customers.list_people' })).toBeNull()
    })
  })

  describe('resolveAgentToolAuditIds', () => {
    it('returns nothing for non-agent tools', () => {
      expect(resolveAgentToolAuditIds({ name: 'customers.list_people' }, { runId: 'x' })).toEqual({})
      expect(resolveAgentToolAuditIds(undefined)).toEqual({})
    })

    it('maps runId to aiAgentRunId and keeps the dispatcher run id', () => {
      expect(
        resolveAgentToolAuditIds(agentTool, { result: {}, agentId: 'catalog.assistant', runId: 'run-1', agentRunId: 'ao-1' }),
      ).toEqual({ agentId: 'catalog.assistant', aiAgentRunId: 'run-1', agentRunId: 'ao-1' })
    })

    it('carries only the agent id when the call produced no result', () => {
      expect(resolveAgentToolAuditIds(agentTool)).toEqual({
        agentId: 'catalog.assistant',
        aiAgentRunId: null,
        agentRunId: null,
      })
    })
  })
})
