/**
 * Tests for Phase 4a additions to /api/ai_assistant/settings:
 *   - PUT /api/ai_assistant/settings — upsert + ACL gate
 *   - DELETE /api/ai_assistant/settings — clear + ACL gate
 *
 * The GET handler is tested implicitly via integration; unit testing
 * the existing GET would require mocking many opencode-provider helpers.
 */

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const upsertDefaultMock = jest.fn()
const clearDefaultMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../data/repositories/AiAgentRuntimeOverrideRepository', () => {
  return {
    AiAgentRuntimeOverrideRepository: jest.fn().mockImplementation(() => ({
      upsertDefault: upsertDefaultMock,
      clearDefault: clearDefaultMock,
    })),
    AiAgentRuntimeOverrideValidationError: class AiAgentRuntimeOverrideValidationError extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'AiAgentRuntimeOverrideValidationError'
      }
    },
  }
})

const readBaseurlAllowlistMock = jest.fn()
const isBaseurlAllowlistedMock = jest.fn()

jest.mock('../../../lib/baseurl-allowlist', () => ({
  readBaseurlAllowlist: (...args: unknown[]) => readBaseurlAllowlistMock(...args),
  isBaseurlAllowlisted: (...args: unknown[]) => isBaseurlAllowlistedMock(...args),
}))

// The GET handler uses opencode-provider helpers — mock only what is needed
// to prevent import errors; GET tests are not included here.
jest.mock('@open-mercato/shared/lib/ai/opencode-provider', () => ({
  OPEN_CODE_PROVIDER_IDS: [],
  OPEN_CODE_PROVIDERS: {},
  getOpenCodeProviderConfiguredEnvKey: () => null,
  isOpenCodeProviderConfigured: () => false,
  resolveOpenCodeModel: () => ({ modelWithProvider: 'gpt-4o-mini' }),
  resolveOpenCodeProviderId: () => 'openai',
}))

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    get: jest.fn(),
    list: jest.fn(() => []),
  },
}))

jest.mock('../../../lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn().mockResolvedValue(undefined),
  listAgents: jest.fn(() => []),
}))

jest.mock('../../../lib/model-factory', () => ({
  createModelFactory: jest.fn(() => ({
    resolveModel: jest.fn(() => ({
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      baseURL: null,
      source: 'provider_default',
    })),
  })),
}))

import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { GET, PUT, DELETE } from '../route'

function buildRequest(method: 'PUT' | 'DELETE', body: unknown): Request {
  return new Request('http://localhost/api/ai_assistant/settings', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('PUT /api/ai_assistant/settings', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.settings.manage'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'em') return {}
        return null
      },
    })
    upsertDefaultMock.mockResolvedValue({
      id: 'row-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: null,
      providerId: 'openai',
      modelId: 'gpt-5-mini',
      baseUrl: null,
      updatedAt: new Date('2026-05-08T00:00:00Z'),
    })
    readBaseurlAllowlistMock.mockReturnValue(['openrouter.ai'])
    isBaseurlAllowlistedMock.mockReturnValue(true)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest('PUT', { providerId: 'openai' }) as any)

    expect(response.status).toBe(401)
  })

  it('returns 403 when caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['ai_assistant.view'], isSuperAdmin: false })

    const response = await PUT(buildRequest('PUT', { providerId: 'openai' }) as any)

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('forbidden')
  })

  it('returns 400 with validation_error for invalid body', async () => {
    const response = await PUT(buildRequest('PUT', 'not-json') as any)

    expect(response.status).toBe(400)
  })

  it('upserts the override and returns the saved row on success', async () => {
    const response = await PUT(
      buildRequest('PUT', { providerId: 'openai', modelId: 'gpt-5-mini', agentId: null }) as any,
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.providerId).toBe('openai')
    expect(json.modelId).toBe('gpt-5-mini')
    expect(upsertDefaultMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5-mini' }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }),
    )
  })

  it('saves per-agent chat override allowlist without requiring a model override', async () => {
    upsertDefaultMock.mockResolvedValueOnce({
      id: 'row-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'catalog.catalog_assistant',
      providerId: null,
      modelId: null,
      baseUrl: null,
      allowedOverrideProviders: ['openai'],
      allowedOverrideModelsByProvider: { openai: ['gpt-5-mini'] },
      updatedAt: new Date('2026-05-08T00:00:00Z'),
    })

    const response = await PUT(
      buildRequest('PUT', {
        agentId: 'catalog.catalog_assistant',
        allowedOverrideProviders: ['openai'],
        allowedOverrideModelsByProvider: { openai: ['gpt-5-mini'] },
      }) as any,
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.allowedOverrideProviders).toEqual(['openai'])
    expect(json.allowedOverrideModelsByProvider).toEqual({ openai: ['gpt-5-mini'] })
    expect(upsertDefaultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'catalog.catalog_assistant',
        allowedOverrideProviders: ['openai'],
        allowedOverrideModelsByProvider: { openai: ['gpt-5-mini'] },
      }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }),
    )
  })

  it('saves per-agent chat override allowlist with inherited providers and no provider override', async () => {
    upsertDefaultMock.mockResolvedValueOnce({
      id: 'row-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'catalog.catalog_assistant',
      providerId: null,
      modelId: null,
      baseUrl: null,
      allowedOverrideProviders: null,
      allowedOverrideModelsByProvider: {},
      updatedAt: new Date('2026-05-08T00:00:00Z'),
    })

    const response = await PUT(
      buildRequest('PUT', {
        agentId: 'catalog.catalog_assistant',
        allowedOverrideProviders: null,
        allowedOverrideModelsByProvider: {},
      }) as any,
    )

    expect(response.status).toBe(200)
    expect(upsertDefaultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'catalog.catalog_assistant',
        allowedOverrideProviders: null,
        allowedOverrideModelsByProvider: {},
      }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }),
    )
  })

  it('requires agentId when saving per-agent chat override allowlist', async () => {
    const response = await PUT(
      buildRequest('PUT', { allowedOverrideProviders: ['openai'] }) as any,
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('agent_required')
    expect(upsertDefaultMock).not.toHaveBeenCalled()
  })

  it('returns 400 baseurl_not_allowlisted when baseURL fails allowlist check', async () => {
    isBaseurlAllowlistedMock.mockReturnValue(false)

    const response = await PUT(
      buildRequest('PUT', { baseURL: 'https://evil.example.com/v1' }) as any,
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('baseurl_not_allowlisted')
    expect(upsertDefaultMock).not.toHaveBeenCalled()
  })

  it('returns 400 provider_unknown when upsert throws AiAgentRuntimeOverrideValidationError', async () => {
    const { AiAgentRuntimeOverrideValidationError } = await import('../../../data/repositories/AiAgentRuntimeOverrideRepository')
    upsertDefaultMock.mockRejectedValueOnce(
      new AiAgentRuntimeOverrideValidationError('Unknown provider id "unknown"'),
    )

    const response = await PUT(buildRequest('PUT', { providerId: 'unknown' }) as any)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('provider_unknown')
  })

  it('allows superAdmin even without the manage feature', async () => {
    loadAclMock.mockResolvedValueOnce({ features: [], isSuperAdmin: true })

    const response = await PUT(buildRequest('PUT', { providerId: 'openai' }) as any)

    expect(response.status).toBe(200)
  })
})

describe('GET /api/ai_assistant/settings', () => {
  let consoleWarnSpy: jest.SpyInstance
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    jest.clearAllMocks()
    originalEnv = { ...process.env }
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    createRequestContainerMock.mockResolvedValue({ resolve: () => null })
  })

  afterEach(() => {
    process.env = originalEnv
    consoleWarnSpy.mockRestore()
  })

  it('does not run LM Studio slashy model ids through the legacy OpenCode model parser', async () => {
    process.env.OM_AI_PROVIDER = 'lm_studio'
    process.env.OM_AI_MODEL = 'qwen/qwen3.5-9b'
    process.env.OM_AI_AVAILABLE_PROVIDERS = 'openai,lm_studio'
    process.env.OM_AI_AVAILABLE_MODELS_LM_STUDIO = 'qwen/qwen3.5-9b'
    process.env.LM_STUDIO_API_KEY = 'lm-studio'

    const provider = {
      id: 'lm-studio',
      name: 'LM Studio (local)',
      defaultModel: '',
      defaultModels: [],
      isConfigured: jest.fn(() => true),
      resolveApiKey: jest.fn(() => 'lm-studio'),
      getConfiguredEnvKey: jest.fn(() => 'LM_STUDIO_API_KEY'),
      createModel: jest.fn(),
      envKeys: ['LM_STUDIO_API_KEY'],
    }
    ;(llmProviderRegistry.list as jest.Mock).mockReturnValue([provider])
    ;(llmProviderRegistry.get as jest.Mock).mockImplementation((id: string) =>
      id === 'lm-studio' ? provider : null,
    )

    const response = await GET(new Request('http://localhost/api/ai_assistant/settings') as any)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.provider.id).toBe('lm-studio')
    expect(json.provider.model).toBe('lm-studio/qwen/qwen3.5-9b')
    expect(json.allowlistProviders[0].id).toBe('lm-studio')
    expect(json.allowlistProviders[0].defaultModel).toBe('qwen/qwen3.5-9b')
    expect(json.allowlistProviders[0].defaultModels).toEqual([
      { id: 'qwen/qwen3.5-9b', name: 'qwen/qwen3.5-9b' },
    ])
  })
})

describe('DELETE /api/ai_assistant/settings', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['ai_assistant.settings.manage'], isSuperAdmin: false })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'em') return {}
        return null
      },
    })
    clearDefaultMock.mockResolvedValue(true)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await DELETE(buildRequest('DELETE', {}) as any)

    expect(response.status).toBe(401)
  })

  it('returns 403 when caller lacks ai_assistant.settings.manage', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['ai_assistant.view'], isSuperAdmin: false })

    const response = await DELETE(buildRequest('DELETE', {}) as any)

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('forbidden')
  })

  it('clears the tenant-wide override and returns { cleared: true }', async () => {
    const response = await DELETE(buildRequest('DELETE', {}) as any)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.cleared).toBe(true)
    expect(clearDefaultMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: null,
    })
  })

  it('clears an agent-specific override when agentId is given', async () => {
    const response = await DELETE(buildRequest('DELETE', { agentId: 'customers.assistant' }) as any)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.cleared).toBe(true)
    expect(clearDefaultMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'customers.assistant',
    })
  })

  it('returns { cleared: false } when no active row was found (idempotent)', async () => {
    clearDefaultMock.mockResolvedValueOnce(false)

    const response = await DELETE(buildRequest('DELETE', {}) as any)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.cleared).toBe(false)
  })
})
