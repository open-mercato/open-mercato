import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiAgentRunDispatcher } from '../agent-run-dispatcher'
import type { McpToolContext } from '../types'

const runAiAgentObjectMock = jest.fn()
const mockAgents = new Map<string, Partial<AiAgentDefinition>>()

jest.mock('../agent-runtime', () => ({
  runAiAgentObject: (...args: unknown[]) => runAiAgentObjectMock(...args),
}))

jest.mock('../agent-registry', () => ({
  loadAgentRegistry: async () => undefined,
  getAgent: (id: string) => mockAgents.get(id),
}))

import { AgentPolicyError } from '../agent-tools'
import { AiAgentDispatchDeniedError } from '../agent-run-dispatcher'
import { AgentToolError } from '../agent-tool-error'
import {
  AGENT_TOOL_DEFAULT_TIMEOUT_MS,
  defineAgentTool,
  isAgentToolFeatureSuperset,
  toAgentRunChannel,
} from '../agent-tool'

const AGENT_ID = 'catalog.product_reviewer'
const reviewSchema = z.object({ verdict: z.string() })

function seedAgent(overrides: Partial<AiAgentDefinition> = {}): void {
  mockAgents.set(AGENT_ID, {
    id: AGENT_ID,
    moduleId: 'catalog',
    executionMode: 'object',
    allowedTools: [],
    requiredFeatures: ['catalog.products.view'],
    output: { schemaName: 'Review', schema: reviewSchema },
    ...overrides,
  })
}

function buildContext(
  overrides: Partial<McpToolContext> = {},
  dispatcher: AiAgentRunDispatcher | null = null,
): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {
      resolve: (name: string) => {
        if (name === 'aiAgentRunDispatcher' && dispatcher) return dispatcher
        throw new Error('not registered')
      },
    } as unknown as McpToolContext['container'],
    userFeatures: ['catalog.products.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

function buildTool(overrides: Partial<Parameters<typeof defineAgentTool>[0]> = {}) {
  return defineAgentTool({
    name: 'catalog.review_product',
    description: 'Review a product',
    agentId: AGENT_ID,
    inputSchema: z.object({ input: z.string() }),
    ...overrides,
  })
}

function buildDispatcher(overrides: Partial<AiAgentRunDispatcher> = {}): AiAgentRunDispatcher & {
  runObject: jest.Mock
} {
  return {
    owns: (agentId: string) => agentId === AGENT_ID,
    isAvailable: async () => true,
    runObject: jest.fn(async () => ({ result: { verdict: 'ok' }, agentRunId: 'ao-run-1' })),
    ...overrides,
  } as AiAgentRunDispatcher & { runObject: jest.Mock }
}

describe('defineAgentTool', () => {
  beforeEach(() => {
    mockAgents.clear()
    runAiAgentObjectMock.mockReset()
    runAiAgentObjectMock.mockResolvedValue({ mode: 'generate', object: { verdict: 'good' }, runId: 'run-1' })
  })

  it('declares a read-only agent tool with the wrapper output schema', () => {
    const tool = buildTool({ outputSchema: reviewSchema })
    expect(tool.isMutation).toBe(false)
    expect(tool.tags).toEqual(['agent'])
    expect(tool.agentRef).toEqual({ agentId: AGENT_ID, engine: 'ai-assistant' })
    const outputSchema = tool.mcp?.outputSchema
    expect(outputSchema?.safeParse({ result: { verdict: 'x' }, agentId: AGENT_ID, runId: null, agentRunId: null }).success).toBe(true)
    expect(outputSchema?.safeParse({ result: { verdict: 1 }, agentId: AGENT_ID, runId: null, agentRunId: null }).success).toBe(false)
  })

  it('leaves requiredFeatures unset for the tool loader to materialize from the agent', () => {
    seedAgent()
    const tool = buildTool()
    expect(tool.requiredFeatures).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(tool, 'requiredFeatures')).toBeUndefined()
  })

  it('keeps explicit requiredFeatures as a plain value', () => {
    const tool = buildTool({ requiredFeatures: ['catalog.products.view', 'catalog.products.manage'] })
    expect(tool.requiredFeatures).toEqual(['catalog.products.view', 'catalog.products.manage'])
  })

  it('runs the ai-assistant engine with the channel, mutation mode and correlation id', async () => {
    seedAgent()
    const tool = buildTool()
    const result = await tool.handler(
      { input: 'Review product 42' },
      buildContext({ channel: 'mcp', mutationMode: 'direct', correlationId: 'corr-1', apiKeyId: 'key-1' }),
    )

    expect(result).toEqual({ result: { verdict: 'good' }, agentId: AGENT_ID, runId: 'run-1', agentRunId: null })
    expect(runAiAgentObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_ID,
        input: 'Review product 42',
        enableTools: true,
        sessionId: 'corr-1',
        channel: 'mcp',
        mutationMode: 'direct',
        apiKeyId: 'key-1',
        correlationId: 'corr-1',
        trace: { channel: 'mcp', correlationId: 'corr-1' },
        authContext: expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }),
      }),
    )
  })

  it('maps the in-process agent channel to the chat run channel and uses toPrompt', async () => {
    seedAgent()
    const tool = defineAgentTool({
      name: 'catalog.review_product',
      description: 'Review a product',
      agentId: AGENT_ID,
      inputSchema: z.object({ input: z.string() }),
      toPrompt: (input) => `Prompt: ${input.input}`,
    })
    await tool.handler({ input: 'x' }, buildContext())
    const call = runAiAgentObjectMock.mock.calls[0][0]
    expect(call.input).toBe('Prompt: x')
    expect(call.channel).toBe('agent')
    expect(call.trace.channel).toBe('chat')
    expect(typeof call.correlationId).toBe('string')
    expect(call.sessionId).toBe(call.correlationId)
  })

  it('maps a policy denial to AGENT_POLICY_DENIED with the deny code', async () => {
    seedAgent()
    const tool = buildTool()
    const error = await tool.handler({ input: 'x' }, buildContext({ userFeatures: [] })).catch((caught) => caught)
    expect(error).toBeInstanceOf(AgentToolError)
    expect(error).toMatchObject({ code: 'AGENT_POLICY_DENIED', denyCode: 'agent_features_denied' })
    expect(error.message).not.toContain('catalog.products.view')
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('maps a runtime AgentPolicyError to AGENT_POLICY_DENIED', async () => {
    seedAgent()
    runAiAgentObjectMock.mockRejectedValue(new AgentPolicyError('execution_mode_not_supported', 'nope'))
    const error = await buildTool().handler({ input: 'x' }, buildContext()).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'AGENT_POLICY_DENIED', denyCode: 'execution_mode_not_supported' })
  })

  it('rejects an object that does not match the agent output schema', async () => {
    seedAgent()
    runAiAgentObjectMock.mockResolvedValue({ mode: 'generate', object: { verdict: 7 }, runId: 'run-1' })
    await expect(buildTool().handler({ input: 'x' }, buildContext())).rejects.toThrow(/does not match its output schema/)
  })

  it('rejects an object that does not match the tool output schema', async () => {
    seedAgent()
    const tool = buildTool({ outputSchema: z.object({ verdict: z.literal('excellent') }) })
    await expect(tool.handler({ input: 'x' }, buildContext())).rejects.toThrow(/does not match its output schema/)
  })

  it('returns AGENT_DISPATCHER_UNAVAILABLE for an unknown agent with no dispatcher', async () => {
    const error = await buildTool().handler({ input: 'x' }, buildContext()).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'AGENT_DISPATCHER_UNAVAILABLE' })
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('fails when explicit requiredFeatures are narrower than the agent features', async () => {
    seedAgent({ requiredFeatures: ['catalog.products.view', 'catalog.products.manage'] })
    const tool = buildTool({ requiredFeatures: ['catalog.products.view'] })
    await expect(tool.handler({ input: 'x' }, buildContext())).rejects.toThrow(/requiredFeatures must cover/)
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('validates the feature superset with wildcard grants', () => {
    expect(isAgentToolFeatureSuperset(['catalog.*'], ['catalog.products.view'])).toBe(true)
    expect(isAgentToolFeatureSuperset(['catalog.products.view'], ['catalog.products.manage'])).toBe(false)
    expect(isAgentToolFeatureSuperset([], undefined)).toBe(true)
  })

  it('routes an owned agent id through the dispatcher', async () => {
    const dispatcher = buildDispatcher()
    const tool = buildTool()
    const result = await tool.handler(
      { input: 'x' },
      buildContext({ channel: 'tools-api', correlationId: 'corr-9', apiKeyId: 'key-9' }, dispatcher),
    )

    expect(result).toEqual({ result: { verdict: 'ok' }, agentId: AGENT_ID, runId: null, agentRunId: 'ao-run-1' })
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
    const dispatchInput = dispatcher.runObject.mock.calls[0][0]
    expect(dispatchInput).toMatchObject({
      agentId: AGENT_ID,
      input: { input: 'x' },
      via: 'tool',
      channel: 'tools-api',
      correlationId: 'corr-9',
      timeoutMs: AGENT_TOOL_DEFAULT_TIMEOUT_MS,
      caller: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        apiKeyId: 'key-9',
        features: ['catalog.products.view'],
        isSuperAdmin: false,
      },
    })
    expect(dispatchInput.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns AGENT_DISPATCHER_UNAVAILABLE when the owning dispatcher is unavailable', async () => {
    const dispatcher = buildDispatcher({ isAvailable: async () => false })
    const error = await buildTool().handler({ input: 'x' }, buildContext({}, dispatcher)).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'AGENT_DISPATCHER_UNAVAILABLE' })
    expect(dispatcher.runObject).not.toHaveBeenCalled()
  })

  it('maps a typed dispatcher denial to AGENT_POLICY_DENIED', async () => {
    const dispatcher = buildDispatcher()
    dispatcher.runObject.mockRejectedValue(new AiAgentDispatchDeniedError('agent_invoke_denied', AGENT_ID))
    const error = await buildTool().handler({ input: 'x' }, buildContext({}, dispatcher)).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'AGENT_POLICY_DENIED', denyCode: 'agent_invoke_denied' })
  })

  it('uses the ai-assistant engine when the dispatcher does not own the agent', async () => {
    seedAgent()
    const dispatcher = buildDispatcher({ owns: () => false })
    const result = await buildTool().handler({ input: 'x' }, buildContext({}, dispatcher))
    expect(result.runId).toBe('run-1')
    expect(dispatcher.runObject).not.toHaveBeenCalled()
  })

  it('dispatches an agent missing from the ai-assistant registry when the cold dispatcher reports it available', async () => {
    const dispatcher = buildDispatcher({ owns: () => false })
    const result = await buildTool().handler({ input: 'x' }, buildContext({}, dispatcher))
    expect(result).toEqual({ result: { verdict: 'ok' }, agentId: AGENT_ID, runId: null, agentRunId: 'ao-run-1' })
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('returns AGENT_DISPATCHER_UNAVAILABLE for an agent neither registry knows', async () => {
    const dispatcher = buildDispatcher({ owns: () => false, isAvailable: async () => false })
    const error = await buildTool().handler({ input: 'x' }, buildContext({}, dispatcher)).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'AGENT_DISPATCHER_UNAVAILABLE' })
    expect(dispatcher.runObject).not.toHaveBeenCalled()
  })

  it('times out a dispatcher run and aborts its signal', async () => {
    let capturedSignal: AbortSignal | undefined
    const dispatcher = buildDispatcher()
    dispatcher.runObject.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      capturedSignal = signal
      return new Promise(() => undefined)
    })
    const tool = buildTool({ timeoutMs: 5 })
    await expect(tool.handler({ input: 'x' }, buildContext({}, dispatcher))).rejects.toThrow(/timed out/)
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('maps tool channels to agent run channels', () => {
    expect(toAgentRunChannel('mcp')).toBe('mcp')
    expect(toAgentRunChannel('tools-api')).toBe('tools-api')
    expect(toAgentRunChannel('agent')).toBe('chat')
    expect(toAgentRunChannel(undefined)).toBe('chat')
  })
})
