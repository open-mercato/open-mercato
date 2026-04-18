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

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
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

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
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

  it('streams a placeholder SSE response on successful policy check', async () => {
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
    const body = await readResponseText(response)
    expect(body).toContain('Agent runtime for')
    expect(body).toContain('customers.assistant')
    expect(body).toContain('is not yet implemented')
    expect(body).toContain('[DONE]')
  })
})
