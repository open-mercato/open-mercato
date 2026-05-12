import type { AiAgentDefinition } from '../../../../../../lib/ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../../../../../lib/agent-registry'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const getSnapshotMock = jest.fn()
const getDefaultMock = jest.fn()
const getExactMock = jest.fn()
const resolveModelMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => {
  const providers = [
    {
      id: 'openai',
      name: 'OpenAI',
      defaultModel: 'gpt-4o',
      defaultModels: [{ id: 'gpt-4o', name: 'GPT-4o' }],
      isConfigured: jest.fn(() => true),
    },
    {
      id: 'lm-studio',
      name: 'LM Studio (local)',
      defaultModel: 'qwen/qwen3.5-9b',
      defaultModels: [{ id: 'qwen/qwen3.5-9b', name: 'qwen/qwen3.5-9b' }],
      isConfigured: jest.fn(() => true),
    },
  ]
  return {
    llmProviderRegistry: {
      list: jest.fn(() => providers),
      get: jest.fn((id: string) => providers.find((provider) => provider.id === id) ?? null),
    },
  }
})

jest.mock('../../../../../../data/repositories/AiTenantModelAllowlistRepository', () => ({
  AiTenantModelAllowlistRepository: jest.fn().mockImplementation(() => ({
    getSnapshot: getSnapshotMock,
  })),
}))

jest.mock('../../../../../../data/repositories/AiAgentRuntimeOverrideRepository', () => ({
  AiAgentRuntimeOverrideRepository: jest.fn().mockImplementation(() => ({
    getDefault: getDefaultMock,
    getExact: getExactMock,
  })),
}))

jest.mock('../../../../../../lib/model-factory', () => ({
  createModelFactory: jest.fn(() => ({
    resolveModel: resolveModelMock,
  })),
}))

import { GET } from '../route'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    requiredFeatures: ['ai_assistant.view'],
    ...overrides,
  }
}

function buildParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

describe('GET /api/ai_assistant/ai/agents/[agentId]/models', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'em') return {}
        return null
      },
    })
    getSnapshotMock.mockResolvedValue(null)
    getDefaultMock.mockResolvedValue(null)
    getExactMock.mockResolvedValue(null)
    resolveModelMock.mockReturnValue({
      providerId: 'openai',
      modelId: 'gpt-4o',
      source: 'provider_default',
      model: {},
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('uses the tenant runtime override when resolving the picker default', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.assistant', moduleId: 'catalog' }),
    ])
    getDefaultMock.mockResolvedValueOnce({
      providerId: 'lm-studio',
      modelId: 'qwen/qwen3.5-9b',
      baseUrl: null,
    })
    resolveModelMock.mockImplementation((input) => ({
      providerId: input.tenantOverride?.providerId ?? 'openai',
      modelId: input.tenantOverride?.modelId ?? 'gpt-4o',
      source: input.tenantOverride ? 'tenant_override' : 'provider_default',
      model: {},
    }))

    const response = await GET(
      new Request('http://localhost/api/ai_assistant/ai/agents/catalog.assistant/models') as any,
      buildParams('catalog.assistant'),
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.defaultProviderId).toBe('lm-studio')
    expect(json.defaultModelId).toBe('qwen/qwen3.5-9b')
    expect(resolveModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantOverride: {
          providerId: 'lm-studio',
          modelId: 'qwen/qwen3.5-9b',
          baseURL: null,
        },
      }),
    )
  })
})
