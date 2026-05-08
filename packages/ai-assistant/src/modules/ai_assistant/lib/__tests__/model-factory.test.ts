import type { AwilixContainer } from 'awilix'
import {
  AiModelFactoryError,
  createModelFactory,
  parseSlashShorthand,
  type AiModelFactoryInput,
  type AiModelFactoryRegistry,
  type CreateModelFactoryDependencies,
} from '../model-factory'

type FakeProvider = {
  id: string
  defaultModel: string
  resolveApiKey: () => string | null
  createModel: (options: { modelId: string; apiKey: string }) => unknown
  isConfigured: () => boolean
}

function makeProvider(overrides: Partial<FakeProvider> = {}): FakeProvider {
  const createModel =
    overrides.createModel ??
    ((options: { modelId: string; apiKey: string }) => ({
      kind: 'fake-model',
      modelId: options.modelId,
      apiKey: options.apiKey,
    }))
  return {
    id: overrides.id ?? 'test-provider',
    defaultModel: overrides.defaultModel ?? 'provider-default-model',
    resolveApiKey: overrides.resolveApiKey ?? (() => 'test-api-key'),
    createModel,
    isConfigured: overrides.isConfigured ?? (() => true),
  }
}

function makeFactoryDeps(
  provider: FakeProvider | null,
  env: Record<string, string | undefined> = {},
): CreateModelFactoryDependencies {
  return {
    registry: {
      resolveFirstConfigured: () =>
        provider as unknown as ReturnType<
          NonNullable<CreateModelFactoryDependencies['registry']>['resolveFirstConfigured']
        >,
    },
    env,
  }
}

/**
 * Builds a registry mock that simulates the real
 * `LlmProviderRegistry.resolveFirstConfigured({ order })` semantics —
 * walks the supplied order first, falls through registration order, only
 * returns providers whose `isConfigured` returns true. Used for the Phase
 * 0 cases that exercise `AI_DEFAULT_PROVIDER` resolution.
 */
function makeMultiProviderRegistry(
  providers: FakeProvider[],
): { registry: AiModelFactoryRegistry; spy: jest.Mock } {
  const spy = jest.fn(
    (
      options?: Parameters<AiModelFactoryRegistry['resolveFirstConfigured']>[0],
    ): FakeProvider | null => {
      const order = options?.order
      if (order && order.length > 0) {
        for (const id of order) {
          const found = providers.find((p) => p.id === id)
          if (found && found.isConfigured()) return found
        }
        const listed = new Set(order)
        for (const provider of providers) {
          if (listed.has(provider.id)) continue
          if (provider.isConfigured()) return provider
        }
        return null
      }
      for (const provider of providers) {
        if (provider.isConfigured()) return provider
      }
      return null
    },
  )
  const registry: AiModelFactoryRegistry = {
    resolveFirstConfigured: (options) =>
      spy(options) as ReturnType<AiModelFactoryRegistry['resolveFirstConfigured']>,
    get: (id: string) => providers.find((p) => p.id === id) ?? null,
  }
  return { registry, spy }
}

const fakeContainer = {} as unknown as AwilixContainer

describe('createModelFactory', () => {
  it('returns the provider default when no override is supplied', () => {
    const provider = makeProvider()
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({})
    expect(resolution.source).toBe('provider_default')
    expect(resolution.modelId).toBe('provider-default-model')
    expect(resolution.providerId).toBe('test-provider')
    expect(resolution.model).toMatchObject({
      kind: 'fake-model',
      modelId: 'provider-default-model',
      apiKey: 'test-api-key',
    })
  })

  it('prefers agentDefaultModel over provider default', () => {
    const provider = makeProvider()
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({ agentDefaultModel: 'agent-pinned-model' })
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-pinned-model')
  })

  it('prefers <MODULE>_AI_MODEL env override over agent default', () => {
    const provider = makeProvider()
    const env = { INBOX_OPS_AI_MODEL: 'env-pinned-model' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned-model',
    })
    expect(resolution.source).toBe('module_env')
    expect(resolution.modelId).toBe('env-pinned-model')
  })

  it('uppercases moduleId when deriving the env var name', () => {
    const provider = makeProvider()
    const env = { INBOX_OPS_AI_MODEL: 'from-env' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    const resolution = factory.resolveModel({ moduleId: 'inbox_ops' })
    expect(resolution.modelId).toBe('from-env')
  })

  it('prefers non-empty callerOverride over every other source', () => {
    const provider = makeProvider()
    const env = { INBOX_OPS_AI_MODEL: 'env-pinned-model' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned-model',
      callerOverride: 'caller-wins',
    })
    expect(resolution.source).toBe('caller_override')
    expect(resolution.modelId).toBe('caller-wins')
  })

  it('treats empty callerOverride as "no override" and falls through to env', () => {
    const provider = makeProvider()
    const env = { INBOX_OPS_AI_MODEL: 'env-pinned-model' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned-model',
      callerOverride: '   ',
    })
    expect(resolution.source).toBe('module_env')
    expect(resolution.modelId).toBe('env-pinned-model')
  })

  it('skips env-override lookup when moduleId is undefined (does not crash)', () => {
    const provider = makeProvider()
    const env = { INBOX_OPS_AI_MODEL: 'env-pinned-model' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    const resolution = factory.resolveModel({
      agentDefaultModel: 'agent-pinned-model',
    } satisfies AiModelFactoryInput)
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-pinned-model')
  })

  it('throws AiModelFactoryError with code "no_provider_configured" when no provider is configured', () => {
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(null))
    try {
      factory.resolveModel({})
      fail('expected AiModelFactoryError')
    } catch (err) {
      expect(err).toBeInstanceOf(AiModelFactoryError)
      const typed = err as AiModelFactoryError
      expect(typed.code).toBe('no_provider_configured')
      expect(typed.message).toMatch(/No LLM provider is configured/i)
    }
  })

  it('throws AiModelFactoryError with code "api_key_missing" when the provider returns no key', () => {
    const provider = makeProvider({ resolveApiKey: () => null })
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider))
    try {
      factory.resolveModel({})
      fail('expected AiModelFactoryError')
    } catch (err) {
      expect(err).toBeInstanceOf(AiModelFactoryError)
      expect((err as AiModelFactoryError).code).toBe('api_key_missing')
    }
  })

  it('passes the resolved modelId and apiKey through to provider.createModel', () => {
    const createModel = jest.fn((options: { modelId: string; apiKey: string }) => ({
      spy: true,
      ...options,
    }))
    const provider = makeProvider({ createModel })
    const env = { CATALOG_AI_MODEL: 'catalog-env-model' }
    const factory = createModelFactory(fakeContainer, makeFactoryDeps(provider, env))
    factory.resolveModel({ moduleId: 'catalog' })
    expect(createModel).toHaveBeenCalledWith({
      modelId: 'catalog-env-model',
      apiKey: 'test-api-key',
    })
  })

  describe('Phase 0 — AI_DEFAULT_PROVIDER + AI_DEFAULT_MODEL', () => {
    it('forwards AI_DEFAULT_PROVIDER to resolveFirstConfigured order', () => {
      const anthropic = makeProvider({ id: 'anthropic', defaultModel: 'claude-sonnet' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { AI_DEFAULT_PROVIDER: 'openai' },
      })
      const resolution = factory.resolveModel({})
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-4o-mini')
      expect(resolution.source).toBe('provider_default')
    })

    it('uses AI_DEFAULT_MODEL as the env_default fallback when nothing higher applies', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const { registry } = makeMultiProviderRegistry([anthropic])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { AI_DEFAULT_MODEL: 'claude-haiku-4-5' },
      })
      const resolution = factory.resolveModel({})
      expect(resolution.source).toBe('env_default')
      expect(resolution.modelId).toBe('claude-haiku-4-5')
      expect(resolution.providerId).toBe('anthropic')
    })

    it('honors both AI_DEFAULT_PROVIDER and AI_DEFAULT_MODEL together', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: {
          AI_DEFAULT_PROVIDER: 'openai',
          AI_DEFAULT_MODEL: 'gpt-5-mini',
        },
      })
      const resolution = factory.resolveModel({})
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('env_default')
    })

    it('falls through when AI_DEFAULT_PROVIDER is registered but unconfigured', () => {
      const anthropic = makeProvider({ id: 'anthropic', isConfigured: () => true })
      const openai = makeProvider({ id: 'openai', isConfigured: () => false })
      const { registry } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: {
          AI_DEFAULT_PROVIDER: 'openai',
          AI_DEFAULT_MODEL: 'gpt-5-mini',
        },
      })
      const resolution = factory.resolveModel({})
      expect(resolution.providerId).toBe('anthropic')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('env_default')
    })

    it('slash-qualified AI_DEFAULT_MODEL resets the provider for that resolution', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { AI_DEFAULT_MODEL: 'openai/gpt-5-mini' },
      })
      const resolution = factory.resolveModel({})
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('env_default')
    })

    it('does not split DeepInfra-style model ids that look like slash shorthand', () => {
      const deepinfra = makeProvider({ id: 'deepinfra' })
      const { registry, spy } = makeMultiProviderRegistry([deepinfra])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { AI_DEFAULT_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
      })
      const resolution = factory.resolveModel({})
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: undefined }),
      )
      expect(resolution.providerId).toBe('deepinfra')
      expect(resolution.modelId).toBe('meta-llama/Llama-3.3-70B-Instruct-Turbo')
      expect(resolution.source).toBe('env_default')
    })

    it('agent_default still beats env_default at lower priority', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const { registry } = makeMultiProviderRegistry([anthropic])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { AI_DEFAULT_MODEL: 'fallback-model' },
      })
      const resolution = factory.resolveModel({ agentDefaultModel: 'agent-wins' })
      expect(resolution.modelId).toBe('agent-wins')
      expect(resolution.source).toBe('agent_default')
    })
  })

  describe('Phase 1 — agentDefaultProvider, <MODULE>_AI_PROVIDER, providerOverride, slash-shorthand on every source', () => {
    it('agentDefaultProvider seeds the provider-axis order hint', () => {
      const anthropic = makeProvider({ id: 'anthropic', defaultModel: 'claude-sonnet' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, { registry, env: {} })
      const resolution = factory.resolveModel({ agentDefaultProvider: 'openai' })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-4o-mini')
      expect(resolution.source).toBe('provider_default')
    })

    it('<MODULE>_AI_PROVIDER env beats agentDefaultProvider for the provider axis', () => {
      const anthropic = makeProvider({ id: 'anthropic', defaultModel: 'claude-sonnet' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const google = makeProvider({ id: 'google', defaultModel: 'gemini-1.5-pro' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai, google])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { CATALOG_AI_PROVIDER: 'google' },
      })
      const resolution = factory.resolveModel({
        moduleId: 'catalog',
        agentDefaultProvider: 'openai',
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['google'] }),
      )
      expect(resolution.providerId).toBe('google')
    })

    it('providerOverride beats <MODULE>_AI_PROVIDER for the provider axis', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const google = makeProvider({ id: 'google', defaultModel: 'gemini-1.5-pro' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai, google])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { CATALOG_AI_PROVIDER: 'google' },
      })
      const resolution = factory.resolveModel({
        moduleId: 'catalog',
        providerOverride: 'openai',
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
    })

    it('slash-qualified agentDefaultModel provides both provider hint and model id', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, { registry, env: {} })
      const resolution = factory.resolveModel({
        agentDefaultModel: 'openai/gpt-5-mini',
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('agent_default')
    })

    it('slash-qualified <MODULE>_AI_MODEL provides both provider hint and model id', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { CATALOG_AI_MODEL: 'openai/gpt-5' },
      })
      const resolution = factory.resolveModel({ moduleId: 'catalog' })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5')
      expect(resolution.source).toBe('module_env')
    })

    it('slash-qualified callerOverride provides both provider hint and model id', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, { registry, env: {} })
      const resolution = factory.resolveModel({ callerOverride: 'openai/gpt-5-mini' })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('caller_override')
    })

    it('cross-axis tie-break: slash-qualified higher-priority model wins over lower-priority plain provider', () => {
      const anthropic = makeProvider({ id: 'anthropic', defaultModel: 'claude-sonnet' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, { registry, env: {} })
      const resolution = factory.resolveModel({
        callerOverride: 'openai/gpt-5-mini',
        agentDefaultProvider: 'anthropic',
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-5-mini')
    })

    it('DeepInfra-style model id in agentDefaultModel is not split (registry guard)', () => {
      const deepinfra = makeProvider({ id: 'deepinfra' })
      const { registry, spy } = makeMultiProviderRegistry([deepinfra])
      const factory = createModelFactory(fakeContainer, { registry, env: {} })
      const resolution = factory.resolveModel({
        agentDefaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: undefined }),
      )
      expect(resolution.modelId).toBe('meta-llama/Llama-3.3-70B-Instruct-Turbo')
      expect(resolution.source).toBe('agent_default')
    })
  })
})

describe('parseSlashShorthand', () => {
  const registry = {
    get: (id: string) =>
      id === 'openai'
        ? ({ id: 'openai', defaultModel: 'gpt-4o-mini' } as never)
        : null,
  }

  it('returns the model id unchanged when there is no slash', () => {
    expect(parseSlashShorthand('gpt-5-mini', registry)).toEqual({
      providerHint: null,
      modelId: 'gpt-5-mini',
    })
  })

  it('splits a slash-qualified token when the prefix matches a registered provider', () => {
    expect(parseSlashShorthand('openai/gpt-5-mini', registry)).toEqual({
      providerHint: 'openai',
      modelId: 'gpt-5-mini',
    })
  })

  it('returns the whole token when the prefix does not match a registered provider', () => {
    expect(parseSlashShorthand('meta-llama/Llama-3.3-70B', registry)).toEqual({
      providerHint: null,
      modelId: 'meta-llama/Llama-3.3-70B',
    })
  })

  it('treats empty prefixes or suffixes as plain model ids', () => {
    expect(parseSlashShorthand('/gpt-5-mini', registry)).toEqual({
      providerHint: null,
      modelId: '/gpt-5-mini',
    })
    expect(parseSlashShorthand('openai/', registry)).toEqual({
      providerHint: null,
      modelId: 'openai/',
    })
  })

  it('disables parsing when the registry does not expose `get`', () => {
    expect(parseSlashShorthand('openai/gpt-5-mini', {})).toEqual({
      providerHint: null,
      modelId: 'openai/gpt-5-mini',
    })
  })
})

describe('Phase 4a — tenantOverride, requestOverride, allowRuntimeModelOverride', () => {
  function makeMultiRegistry(providers: FakeProvider[]): AiModelFactoryRegistry {
    return {
      resolveFirstConfigured: (options) => {
        const order = options?.order
        if (order && order.length > 0) {
          for (const id of order) {
            const found = providers.find((p) => p.id === id)
            if (found && found.isConfigured()) return found as unknown as ReturnType<AiModelFactoryRegistry['resolveFirstConfigured']>
          }
          const listed = new Set(order)
          for (const p of providers) {
            if (!listed.has(p.id) && p.isConfigured()) return p as unknown as ReturnType<AiModelFactoryRegistry['resolveFirstConfigured']>
          }
          return null
        }
        return providers.find((p) => p.isConfigured()) as unknown as ReturnType<AiModelFactoryRegistry['resolveFirstConfigured']> ?? null
      },
      get: (id: string) => providers.find((p) => p.id === id) as unknown as ReturnType<NonNullable<AiModelFactoryRegistry['get']>> ?? null,
    }
  }

  it('requestOverride wins over callerOverride for both model and provider axes', () => {
    const anthropic = makeProvider({ id: 'anthropic' })
    const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
    const factory = createModelFactory({} as AwilixContainer, {
      registry: makeMultiRegistry([anthropic, openai]),
      env: {},
    })
    const resolution = factory.resolveModel({
      callerOverride: 'some-caller-model',
      requestOverride: { providerId: 'openai', modelId: 'gpt-5-mini' },
    })
    expect(resolution.source).toBe('request_override')
    expect(resolution.modelId).toBe('gpt-5-mini')
    expect(resolution.providerId).toBe('openai')
  })

  it('tenantOverride sits below callerOverride but above module_env', () => {
    const anthropic = makeProvider({ id: 'anthropic' })
    const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
    const factory = createModelFactory({} as AwilixContainer, {
      registry: makeMultiRegistry([anthropic, openai]),
      env: {},
    })
    const resolution = factory.resolveModel({
      tenantOverride: { providerId: 'openai', modelId: 'tenant-model' },
      agentDefaultModel: 'agent-model',
    })
    expect(resolution.source).toBe('tenant_override')
    expect(resolution.modelId).toBe('tenant-model')
    expect(resolution.providerId).toBe('openai')
  })

  it('allowRuntimeModelOverride: false skips requestOverride (step 1)', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      allowRuntimeModelOverride: false,
      requestOverride: { modelId: 'blocked-model' },
      agentDefaultModel: 'agent-wins',
    })
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-wins')
  })

  it('allowRuntimeModelOverride: false skips tenantOverride (step 3)', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      allowRuntimeModelOverride: false,
      tenantOverride: { modelId: 'blocked-tenant-model' },
      agentDefaultModel: 'agent-wins',
    })
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-wins')
  })

  it('allowRuntimeModelOverride: false still honors callerOverride (step 2)', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      allowRuntimeModelOverride: false,
      callerOverride: 'caller-still-wins',
      tenantOverride: { modelId: 'blocked' },
    })
    expect(resolution.source).toBe('caller_override')
    expect(resolution.modelId).toBe('caller-still-wins')
  })

  it('allowRuntimeModelOverride: true (default) honors tenantOverride', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      tenantOverride: { modelId: 'tenant-model' },
    })
    expect(resolution.source).toBe('tenant_override')
    expect(resolution.modelId).toBe('tenant-model')
  })

  it('requestOverride baseURL is resolved when runtimeOverrides are allowed', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      requestOverride: { baseURL: 'https://custom.example.com/v1' },
    })
    expect(resolution.baseURL).toBe('https://custom.example.com/v1')
  })

  it('tenantOverride baseURL sits below requestOverride but above agentDefaultBaseUrl', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      tenantOverride: { baseURL: 'https://tenant.example.com/v1' },
      agentDefaultBaseUrl: 'https://agent.example.com/v1',
    })
    expect(resolution.baseURL).toBe('https://tenant.example.com/v1')
  })

  it('allowRuntimeModelOverride: false suppresses requestOverride baseURL', () => {
    const provider = makeProvider()
    const factory = createModelFactory({} as AwilixContainer, makeFactoryDeps(provider))
    const resolution = factory.resolveModel({
      allowRuntimeModelOverride: false,
      requestOverride: { baseURL: 'https://blocked.example.com/v1' },
    })
    expect(resolution.baseURL).toBeUndefined()
  })
})
