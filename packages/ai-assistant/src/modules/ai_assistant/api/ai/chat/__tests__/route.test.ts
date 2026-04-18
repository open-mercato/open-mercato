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
const runAiAgentTextMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../lib/agent-runtime', () => ({
  runAiAgentText: (...args: unknown[]) => runAiAgentTextMock(...args),
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

function buildRequest(options: {
  agent?: string | null
  body?: unknown
  bodyRaw?: string
}): Request {
  const url = new URL('http://localhost/api/ai/chat')
  if (options.agent !== undefined && options.agent !== null) {
    url.searchParams.set('agent', options.agent)
  }
  const init: RequestInit = { method: 'POST' }
  if (options.bodyRaw !== undefined) {
    init.body = options.bodyRaw
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
    init.headers = { 'content-type': 'application/json' }
  }
  return new Request(url, init)
}

describe('POST /api/ai/chat', () => {
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
    runAiAgentTextMock.mockResolvedValue(
      new Response('data: {"type":"text","content":"ok"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
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

    const response = await POST(buildRequest({ agent: 'customers.assistant', body: { messages: [{ role: 'user', content: 'hi' }] } }) as any)

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.code).toBe('unauthenticated')
  })

  it('returns 400 when the agent query param is missing', async () => {
    const response = await POST(buildRequest({ body: { messages: [{ role: 'user', content: 'hi' }] } }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 400 when the agent query param is malformed', async () => {
    const response = await POST(buildRequest({ agent: 'BadAgent', body: { messages: [{ role: 'user', content: 'hi' }] } }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 400 when body fails zod validation (missing messages)', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
    ])

    const response = await POST(buildRequest({ agent: 'customers.assistant', body: {} }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 400 when messages exceed the cap', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
    ])

    const messages = Array.from({ length: 101 }, (_, index) => ({
      role: 'user' as const,
      content: `msg-${index}`,
    }))

    const response = await POST(buildRequest({ agent: 'customers.assistant', body: { messages } }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('validation_error')
  })

  it('returns 404 for an unknown agent', async () => {
    // registry intentionally empty
    const response = await POST(
      buildRequest({ agent: 'customers.missing', body: { messages: [{ role: 'user', content: 'hi' }] } }) as any,
    )

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.code).toBe('agent_unknown')
  })

  it('returns 403 when the agent requires features the user lacks', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        requiredFeatures: ['customers.assistant.use'],
      }),
    ])
    loadAclMock.mockResolvedValueOnce({ features: ['ai_assistant.view'], isSuperAdmin: false })

    const response = await POST(
      buildRequest({
        agent: 'customers.assistant',
        body: { messages: [{ role: 'user', content: 'hi' }] },
      }) as any,
    )

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('agent_features_denied')
  })

  it('returns 409 when an object-mode agent is invoked via chat transport', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extract',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schema: z.object({ title: z.string() }) },
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'catalog.extract',
        body: { messages: [{ role: 'user', content: 'hi' }] },
      }) as any,
    )

    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe('execution_mode_not_supported')
  })

  it('delegates to runAiAgentText with the resolved auth and body payload', async () => {
    registerMcpTool(
      makeTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] }),
      { moduleId: 'customers' },
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers.list_people'],
      }),
    ])

    const response = await POST(
      buildRequest({
        agent: 'customers.assistant',
        body: {
          messages: [{ role: 'user', content: 'Hello assistant' }],
          debug: true,
          pageContext: { pageId: 'customers.people' },
        },
      }) as any,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(runAiAgentTextMock).toHaveBeenCalledTimes(1)
    const callArg = runAiAgentTextMock.mock.calls[0][0] as {
      agentId: string
      messages: unknown
      debug?: boolean
      pageContext?: { pageId?: string }
      authContext: { tenantId: string | null; organizationId: string | null; userId: string }
      container: unknown
    }
    expect(callArg.agentId).toBe('customers.assistant')
    expect(callArg.debug).toBe(true)
    expect(callArg.pageContext).toEqual({ pageId: 'customers.people' })
    expect(callArg.authContext.userId).toBe('user-1')
    expect(callArg.authContext.tenantId).toBe('tenant-1')
    expect(callArg.authContext.organizationId).toBe('org-1')
    expect(callArg.container).toBeDefined()
  })

  it('maps AgentPolicyError thrown by the runtime to the canonical HTTP status', async () => {
    const { AgentPolicyError } = await import('../../../../lib/agent-tools')
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
    ])
    runAiAgentTextMock.mockRejectedValueOnce(
      new AgentPolicyError('tool_not_whitelisted', 'Tool not whitelisted'),
    )

    const response = await POST(
      buildRequest({
        agent: 'customers.assistant',
        body: { messages: [{ role: 'user', content: 'hi' }] },
      }) as any,
    )

    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe('tool_not_whitelisted')
  })
})
