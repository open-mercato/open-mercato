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

jest.mock('../../../../lib/agent-runtime', () => {
  const actual = jest.requireActual<typeof import('../../../../lib/agent-runtime')>('../../../../lib/agent-runtime')
  return {
    ...actual,
    runAiAgentText: (...args: unknown[]) => runAiAgentTextMock(...args),
  }
})

const getMock = jest.fn()
const listMock = jest.fn()

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    get: (...args: unknown[]) => getMock(...args),
    list: (...args: unknown[]) => listMock(...args),
  },
}))

const readBaseurlAllowlistMock = jest.fn()
const isBaseurlAllowlistedMock = jest.fn()

jest.mock('../../../../lib/baseurl-allowlist', () => ({
  readBaseurlAllowlist: (...args: unknown[]) => readBaseurlAllowlistMock(...args),
  isBaseurlAllowlisted: (...args: unknown[]) => isBaseurlAllowlistedMock(...args),
}))

const tenantAllowlistGetSnapshotMock = jest.fn()
const agentRuntimeOverrideGetExactMock = jest.fn()

jest.mock('../../../../data/repositories/AiTenantModelAllowlistRepository', () => ({
  AiTenantModelAllowlistRepository: jest.fn().mockImplementation(() => ({
    getSnapshot: (...args: unknown[]) => tenantAllowlistGetSnapshotMock(...args),
  })),
}))

jest.mock('../../../../data/repositories/AiAgentRuntimeOverrideRepository', () => ({
  AiAgentRuntimeOverrideRepository: jest.fn().mockImplementation(() => ({
    getExact: (...args: unknown[]) => agentRuntimeOverrideGetExactMock(...args),
  })),
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
        if (name === 'em') return {}
        return null
      },
    })
    tenantAllowlistGetSnapshotMock.mockResolvedValue(null)
    agentRuntimeOverrideGetExactMock.mockResolvedValue(null)
    runAiAgentTextMock.mockResolvedValue(
      new Response('data: {"type":"text","content":"ok"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    // Phase 4a defaults: provider registry returns a configured provider by default
    getMock.mockReturnValue({ id: 'openai', isConfigured: () => true })
    listMock.mockReturnValue([{ id: 'openai', isConfigured: () => true }])
    readBaseurlAllowlistMock.mockReturnValue(['openrouter.ai'])
    isBaseurlAllowlistedMock.mockReturnValue(true)
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

  describe('Phase 4a — query-param override validation', () => {
    function buildRequestWithOverrides(overrides: {
      provider?: string
      model?: string
      baseUrl?: string
    }): Request {
      const url = new URL('http://localhost/api/ai/chat')
      url.searchParams.set('agent', 'customers.assistant')
      if (overrides.provider) url.searchParams.set('provider', overrides.provider)
      if (overrides.model) url.searchParams.set('model', overrides.model)
      if (overrides.baseUrl) url.searchParams.set('baseUrl', overrides.baseUrl)
      return new Request(url, {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        headers: { 'content-type': 'application/json' },
      })
    }

    it('returns 400 with code runtime_override_disabled when agent has allowRuntimeOverride: false', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowRuntimeOverride: false }),
      ])

      const response = await POST(buildRequestWithOverrides({ provider: 'openai' }) as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('runtime_override_disabled')
    })

    it('returns 400 with code provider_unknown when provider is not registered', async () => {
      getMock.mockReturnValue(null)
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithOverrides({ provider: 'unknown-provider' }) as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('provider_unknown')
    })

    it('returns 400 with code provider_not_configured when provider is registered but not configured', async () => {
      getMock.mockReturnValue({ id: 'openai', isConfigured: () => false })
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithOverrides({ provider: 'openai' }) as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('provider_not_configured')
    })

    it('returns 400 with code baseurl_not_allowlisted when baseUrl is not in the allowlist', async () => {
      isBaseurlAllowlistedMock.mockReturnValue(false)
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithOverrides({ baseUrl: 'https://evil.example.com/v1' }) as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('baseurl_not_allowlisted')
    })

    it('accepts valid provider and model overrides and forwards requestOverride to runAiAgentText', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await POST(buildRequestWithOverrides({ provider: 'openai', model: 'gpt-5-mini' }) as any)

      expect(runAiAgentTextMock).toHaveBeenCalledTimes(1)
      const callArg = runAiAgentTextMock.mock.calls[0][0] as {
        requestOverride?: { providerId?: string | null; modelId?: string | null; baseURL?: string | null }
      }
      expect(callArg.requestOverride).toEqual({
        providerId: 'openai',
        modelId: 'gpt-5-mini',
        baseURL: null,
      })
    })

    it('does NOT set requestOverride when no override query params are present', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await POST(
        buildRequest({ agent: 'customers.assistant', body: { messages: [{ role: 'user', content: 'hi' }] } }) as any,
      )

      const callArg = runAiAgentTextMock.mock.calls[0][0] as { requestOverride?: unknown }
      expect(callArg.requestOverride).toBeUndefined()
    })

    it('accepts valid baseUrl that passes the allowlist check', async () => {
      isBaseurlAllowlistedMock.mockReturnValue(true)
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(
        buildRequestWithOverrides({ baseUrl: 'https://openrouter.ai/api/v1' }) as any,
      )

      expect(response.status).toBe(200)
      const callArg = runAiAgentTextMock.mock.calls[0][0] as {
        requestOverride?: { providerId?: string | null; modelId?: string | null; baseURL?: string | null }
      }
      expect(callArg.requestOverride?.baseURL).toBe('https://openrouter.ai/api/v1')
    })
  })

  describe('Phase 1780-5 / 1780-6 — env + tenant allowlist rejections', () => {
    function buildRequestWithOverrides(overrides: {
      provider?: string
      model?: string
    }): Request {
      const url = new URL('http://localhost/api/ai/chat')
      url.searchParams.set('agent', 'customers.assistant')
      if (overrides.provider) url.searchParams.set('provider', overrides.provider)
      if (overrides.model) url.searchParams.set('model', overrides.model)
      return new Request(url, {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        headers: { 'content-type': 'application/json' },
      })
    }

    const savedEnv: Record<string, string | undefined> = {}
    const ENV_KEYS = [
      'OM_AI_AVAILABLE_PROVIDERS',
      'OM_AI_AVAILABLE_MODELS_OPENAI',
      'OM_AI_AVAILABLE_MODELS_ANTHROPIC',
    ]

    beforeEach(() => {
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key]
        delete process.env[key]
      }
      getMock.mockImplementation((id: string) => {
        if (id === 'openai') return { id: 'openai', isConfigured: () => true }
        if (id === 'anthropic') return { id: 'anthropic', isConfigured: () => true }
        return null
      })
      listMock.mockReturnValue([
        { id: 'openai', isConfigured: () => true },
        { id: 'anthropic', isConfigured: () => true },
      ])
    })

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = savedEnv[key]
        }
      }
    })

    it('returns 400 provider_not_allowlisted when OM_AI_AVAILABLE_PROVIDERS excludes the requested provider', async () => {
      process.env.OM_AI_AVAILABLE_PROVIDERS = 'anthropic'
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithOverrides({ provider: 'openai' }) as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('provider_not_allowlisted')
      expect(json.error).toContain('OM_AI_AVAILABLE_PROVIDERS')
    })

    it('returns 400 model_not_allowlisted when OM_AI_AVAILABLE_MODELS_OPENAI excludes the requested model', async () => {
      process.env.OM_AI_AVAILABLE_MODELS_OPENAI = 'gpt-4o'
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(
        buildRequestWithOverrides({ provider: 'openai', model: 'gpt-5-mini' }) as any,
      )

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('model_not_allowlisted')
      expect(json.error).toContain('OM_AI_AVAILABLE_MODELS_OPENAI')
    })

    it('returns 503 tenant_allowlist_unavailable when the tenant allowlist lookup throws (fail closed)', async () => {
      tenantAllowlistGetSnapshotMock.mockRejectedValueOnce(new Error('db connection refused'))
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithOverrides({ provider: 'openai' }) as any)

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json.code).toBe('tenant_allowlist_unavailable')
    })

    it('returns 400 model_not_allowlisted with "env ∩ tenant" wording when the tenant snapshot narrows the env allowlist', async () => {
      process.env.OM_AI_AVAILABLE_PROVIDERS = 'openai'
      process.env.OM_AI_AVAILABLE_MODELS_OPENAI = 'gpt-4o,gpt-5-mini'
      tenantAllowlistGetSnapshotMock.mockResolvedValue({
        allowedProviders: ['openai'],
        allowedModelsByProvider: { openai: ['gpt-4o'] },
      })
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(
        buildRequestWithOverrides({ provider: 'openai', model: 'gpt-5-mini' }) as any,
      )

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('model_not_allowlisted')
      expect(json.error).toContain('env ∩ tenant')
    })
  })

  describe('Phase 4 (1782) — loopBudget query-param (TC-AI-AGENT-LOOP-002)', () => {
    function buildRequestWithLoopBudget(loopBudget: string): Request {
      const url = new URL('http://localhost/api/ai/chat')
      url.searchParams.set('agent', 'customers.assistant')
      url.searchParams.set('loopBudget', loopBudget)
      return new Request(url, {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        headers: { 'content-type': 'application/json' },
      })
    }

    it('forwards tight preset budget to runAiAgentText', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await POST(buildRequestWithLoopBudget('tight') as any)

      expect(runAiAgentTextMock).toHaveBeenCalledTimes(1)
      const callArg = runAiAgentTextMock.mock.calls[0][0] as {
        loop?: {
          maxSteps?: number
          budget?: { maxToolCalls?: number; maxWallClockMs?: number; maxTokens?: number }
        }
      }
      expect(callArg.loop?.maxSteps).toBe(3)
      expect(callArg.loop?.budget).toEqual({
        maxToolCalls: 3,
        maxWallClockMs: 10_000,
        maxTokens: 50_000,
      })
    })

    it('forwards loose preset budget to runAiAgentText', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await POST(buildRequestWithLoopBudget('loose') as any)

      expect(runAiAgentTextMock).toHaveBeenCalledTimes(1)
      const callArg = runAiAgentTextMock.mock.calls[0][0] as {
        loop?: {
          maxSteps?: number
          budget?: { maxToolCalls?: number; maxWallClockMs?: number; maxTokens?: number }
        }
      }
      expect(callArg.loop?.maxSteps).toBe(20)
      expect(callArg.loop?.budget).toEqual({
        maxToolCalls: 20,
        maxWallClockMs: 120_000,
        maxTokens: 500_000,
      })
    })

    it('sends no loop override when loopBudget=default', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await POST(buildRequestWithLoopBudget('default') as any)

      expect(runAiAgentTextMock).toHaveBeenCalledTimes(1)
      const callArg = runAiAgentTextMock.mock.calls[0][0] as {
        loop?: unknown
      }
      expect(callArg.loop).toBeUndefined()
    })

    it('returns 400 runtime_override_disabled when loopBudget=tight and allowRuntimeOverride: false', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowRuntimeOverride: false }),
      ])

      const response = await POST(buildRequestWithLoopBudget('tight') as any)

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.code).toBe('runtime_override_disabled')
    })

    it('accepts loopBudget=tight when loop.allowRuntimeOverride is true (default)', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const response = await POST(buildRequestWithLoopBudget('tight') as any)

      expect(response.status).toBe(200)
    })
  })
})
