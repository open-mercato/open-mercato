import { z } from 'zod'
import type { AiAgentDefinition } from '../../../../lib/ai-agent-definition'
import type { AiToolDefinition } from '../../../../lib/types'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../../../lib/agent-registry'
import { toolRegistry, registerMcpTool } from '../../../../lib/tool-registry'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const runAiAgentObjectMock = jest.fn()
let containerDispatcher: unknown = null

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../lib/agent-runtime', () => ({
  runAiAgentObject: (...args: unknown[]) => runAiAgentObjectMock(...args),
}))

import { POST } from '../route'
import { AiAgentDispatchDeniedError } from '../../../../lib/agent-run-dispatcher'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

const RUN_ID = '0b9f8c4e-6f1a-4d55-9a3b-2c7d1e5f4a10'

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/ai_assistant/ai/run-object', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai_assistant/ai/run-object', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    containerDispatcher = null
    resetAgentRegistryForTests()
    toolRegistry.clear()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.view'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'aiAgentRunDispatcher' && containerDispatcher) return containerDispatcher
        return null
      },
    })
    runAiAgentObjectMock.mockResolvedValue({
      mode: 'generate',
      runId: RUN_ID,
      object: { title: 'hello' },
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20 },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.code).toBe('unauthenticated')
  })

  it('returns 400 when the body fails zod validation (missing messages)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(buildRequest({ agent: 'catalog.extract' }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 404 for an unknown agent', async () => {
    const response = await POST(
      buildRequest({
        agent: 'catalog.missing',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.code).toBe('agent_unknown')
  })

  it('returns 403 when the agent requires features the user lacks', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        requiredFeatures: ['catalog.extract.use'],
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('agent_features_denied')
  })

  it('returns 422 when a chat-mode agent is invoked via run-object', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'customers.assistant',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(422)
    const json = await response.json()
    expect(json.code).toBe('execution_mode_not_supported')
  })

  it('returns 200 and delegates to runAiAgentObject on success', async () => {
    registerMcpTool(
      makeTool({ name: 'catalog.read_product', requiredFeatures: ['catalog.products.view'] }),
      { moduleId: 'catalog' },
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        allowedTools: ['catalog.read_product'],
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'Generate a product title' }],
        pageContext: { pageId: 'ai_assistant.playground' },
      }) as any,
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({
      runId: RUN_ID,
      object: { title: 'hello' },
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20 },
    })
    expect(runAiAgentObjectMock).toHaveBeenCalledTimes(1)
    const callArg = runAiAgentObjectMock.mock.calls[0][0] as {
      agentId: string
      input: unknown
      pageContext?: { pageId?: string }
      authContext: { userId: string; tenantId: string | null; organizationId: string | null }
    }
    expect(callArg.agentId).toBe('catalog.extract')
    expect(callArg.pageContext).toEqual({ pageId: 'ai_assistant.playground' })
    expect(callArg.authContext.userId).toBe('user-1')
    expect(callArg.authContext.tenantId).toBe('tenant-1')
    expect(callArg.authContext.organizationId).toBe('org-1')
  })

  it('forwards callSettings, the run-object channel and the request correlation id', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest(
        {
          agent: 'catalog.extract',
          messages: [{ role: 'user', content: 'hi' }],
          callSettings: { temperature: 0.2, maxOutputTokens: 256 },
        },
        { 'x-correlation-id': '  req-123  ' },
      ) as any,
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.runId).toBe(RUN_ID)
    const callArg = runAiAgentObjectMock.mock.calls[0][0] as {
      callSettings?: Record<string, unknown>
      trace?: { channel?: string; correlationId?: string }
    }
    expect(callArg.callSettings).toEqual({ temperature: 0.2, maxOutputTokens: 256 })
    expect(callArg.trace).toEqual({ channel: 'run-object', correlationId: 'req-123' })
  })

  it('generates a correlation id when the header is missing or oversized', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    await POST(
      buildRequest(
        { agent: 'catalog.extract', messages: [{ role: 'user', content: 'hi' }] },
        { 'x-correlation-id': 'x'.repeat(129) },
      ) as any,
    )

    const callArg = runAiAgentObjectMock.mock.calls[0][0] as {
      callSettings?: unknown
      trace?: { channel?: string; correlationId?: string }
    }
    expect(callArg.callSettings).toBeUndefined()
    expect(callArg.trace?.channel).toBe('run-object')
    expect(callArg.trace?.correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 400 when callSettings contains an unknown key', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
        callSettings: { temperature: 0.2, unknownKnob: true },
      }) as any,
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ providerOptions: { openai: { user: 'abc' } } }],
    [{ maxOutputTokens: 1_000_000 }],
    [{ temperature: 5 }],
    [{ stopSequences: ['a', 'b', 'c', 'd', 'e'] }],
  ])('returns 400 when callSettings is outside the HTTP contract: %j', async (callSettings) => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
        callSettings,
      }) as never,
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('returns 422 when the helper resolves to stream mode', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])
    runAiAgentObjectMock.mockResolvedValueOnce({
      mode: 'stream',
      object: Promise.resolve({ title: 'hello' }),
      partialObjectStream: (async function* () {})(),
      textStream: (async function* () {})(),
    })

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(422)
    const json = await response.json()
    expect(json.code).toBe('execution_mode_not_supported')
  })

  it('maps AgentPolicyError thrown by the runtime to the canonical HTTP status', async () => {
    const { AgentPolicyError } = await import('../../../../lib/agent-tools')
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Extract', schema: z.object({ title: z.string() }) },
      }),
    ])
    runAiAgentObjectMock.mockRejectedValueOnce(
      new AgentPolicyError('tool_not_whitelisted', 'Tool not whitelisted'),
    )

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        messages: [{ role: 'user', content: 'hi' }],
      }) as any,
    )

    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe('tool_not_whitelisted')
  })

  describe('dispatcher-owned agents', () => {
    const AO_AGENT = 'ops.triage'
    const AGENT_RUN_ID = 'ao-run-1'

    function makeDispatcher(options: { owned?: string[]; available?: boolean } = {}) {
      const owned = options.owned ?? [AO_AGENT]
      return {
        owns: jest.fn((agentId: string) => owned.includes(agentId)),
        isAvailable: jest.fn(async () => options.available ?? true),
        runObject: jest.fn(async () => ({
          result: { verdict: 'ok' },
          agentRunId: AGENT_RUN_ID,
          usage: { inputTokens: 3, outputTokens: 4 },
          finishReason: null,
        })),
      }
    }

    function seedNativeAoAgent(requiredFeatures?: string[]) {
      seedAgentRegistryForTests([
        makeAgent({
          id: AO_AGENT,
          moduleId: 'ops',
          executionMode: 'object',
          readOnly: true,
          output: { schemaName: 'Triage', schema: z.object({ verdict: z.string() }) },
          ...(requiredFeatures ? { requiredFeatures } : {}),
        }),
      ])
    }

    function postAgent(messages: Array<{ role: string; content: string }> = [{ role: 'user', content: 'triage this' }], extra: Record<string, unknown> = {}) {
      return POST(
        buildRequest({ agent: AO_AGENT, messages, ...extra }, { 'x-correlation-id': 'corr-123' }) as any,
      )
    }

    it('delegates an owned agent to the dispatcher and returns runId null with agentRunId', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher

      const response = await postAgent(undefined, { callSettings: { temperature: 0.2 } })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        runId: null,
        agentRunId: AGENT_RUN_ID,
        object: { verdict: 'ok' },
        usage: { inputTokens: 3, outputTokens: 4 },
      })
      expect(runAiAgentObjectMock).not.toHaveBeenCalled()
      expect(dispatcher.runObject).toHaveBeenCalledWith({
        agentId: AO_AGENT,
        input: 'triage this',
        caller: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          userId: 'user-1',
          apiKeyId: null,
          features: ['ai_assistant.view'],
          isSuperAdmin: false,
        },
        channel: 'run-object',
        via: 'route',
        correlationId: 'corr-123',
        callSettings: { temperature: 0.2 },
        timeoutMs: 120000,
      })
    })

    it('passes the messages array when more than one message is sent', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher
      const messages = [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'triage this' },
      ]

      await postAgent(messages)

      expect(dispatcher.runObject).toHaveBeenCalledWith(expect.objectContaining({ input: messages }))
    })

    it('binds an API-key caller to the key and its owner', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher
      authMock.mockResolvedValueOnce({
        sub: 'api_key:key-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        isApiKey: true,
        keyId: 'key-1',
        userId: 'owner-1',
      })

      await postAgent()

      expect(dispatcher.runObject).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: expect.objectContaining({ userId: 'owner-1', apiKeyId: 'key-1' }),
        }),
      )
    })

    it.each<[string, Record<string, unknown>]>([
      ['attachmentIds', { attachmentIds: ['att-1'] }],
      ['pageContext', { pageContext: { pageId: 'page-1' } }],
      ['modelOverride', { modelOverride: 'openai/gpt-5-mini' }],
    ])('returns 422 dispatch_option_unsupported when %s is sent for a dispatched agent', async (_label, extra) => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher

      const response = await postAgent(undefined, extra)

      expect(response.status).toBe(422)
      const body = await response.json()
      expect(body.code).toBe('dispatch_option_unsupported')
      expect(body.error).not.toContain(AO_AGENT)
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('checks the agent feature policy before reporting an unsupported dispatch option', async () => {
      seedNativeAoAgent(['ops.triage.run'])
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher

      const response = await postAgent(undefined, { modelOverride: 'openai/gpt-5-mini' })

      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('agent_features_denied')
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('dispatches when attachmentIds is an empty array', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher

      const response = await postAgent(undefined, { attachmentIds: [] })

      expect(response.status).toBe(200)
      expect(dispatcher.runObject).toHaveBeenCalledTimes(1)
    })

    it('runs the agent feature policy before dispatching a natively registered agent', async () => {
      seedNativeAoAgent(['ops.triage.run'])
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('agent_features_denied')
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('maps a dispatcher invoke denial to 403 without echoing feature names', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      dispatcher.runObject.mockRejectedValueOnce(new AiAgentDispatchDeniedError('agent_invoke_denied', AO_AGENT))
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(403)
      const json = await response.json()
      expect(json).toEqual({ error: 'Access to this agent is denied.', code: 'agent_features_denied' })
    })

    it('maps a missing principal denial to 409', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      dispatcher.runObject.mockRejectedValueOnce(new AiAgentDispatchDeniedError('agent_principal_missing', AO_AGENT))
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('agent_principal_missing')
    })

    it('returns 409 without dispatching when the caller has no tenant scope', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher()
      containerDispatcher = dispatcher
      authMock.mockResolvedValueOnce({ sub: 'user-1', tenantId: null, orgId: null })

      const response = await postAgent()

      expect(response.status).toBe(409)
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('returns 404 when the owning dispatcher reports the agent unavailable', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher({ available: false })
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('agent_unknown')
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('keeps the ai-assistant path for agents the dispatcher does not own', async () => {
      seedNativeAoAgent()
      const dispatcher = makeDispatcher({ owned: [] })
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(200)
      expect((await response.json()).runId).toBe(RUN_ID)
      expect(runAiAgentObjectMock).toHaveBeenCalledTimes(1)
      expect(dispatcher.isAvailable).not.toHaveBeenCalled()
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })

    it('dispatches a file agent missing from both registries on a cold process when it is available', async () => {
      const dispatcher = makeDispatcher({ owned: [] })
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(200)
      expect((await response.json()).agentRunId).toBe(AGENT_RUN_ID)
      expect(dispatcher.isAvailable).toHaveBeenCalledWith(AO_AGENT)
      expect(dispatcher.runObject).toHaveBeenCalledTimes(1)
      expect(runAiAgentObjectMock).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown agent the dispatcher does not have either', async () => {
      const dispatcher = makeDispatcher({ owned: [], available: false })
      containerDispatcher = dispatcher

      const response = await postAgent()

      expect(response.status).toBe(404)
      expect(dispatcher.runObject).not.toHaveBeenCalled()
    })
  })
})
