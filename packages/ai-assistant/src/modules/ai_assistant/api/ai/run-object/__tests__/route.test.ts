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
})
