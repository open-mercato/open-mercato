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
 * 0 cases that exercise `OM_AI_PROVIDER` resolution.
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

  describe('Phase 0 — OM_AI_PROVIDER + OM_AI_MODEL', () => {
    it('forwards OM_AI_PROVIDER to resolveFirstConfigured order', () => {
      const anthropic = makeProvider({ id: 'anthropic', defaultModel: 'claude-sonnet' })
      const openai = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { OM_AI_PROVIDER: 'openai' },
      })
      const resolution = factory.resolveModel({})
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ order: ['openai'] }),
      )
      expect(resolution.providerId).toBe('openai')
      expect(resolution.modelId).toBe('gpt-4o-mini')
      expect(resolution.source).toBe('provider_default')
    })

    it('uses OM_AI_MODEL as the env_default fallback when nothing higher applies', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const { registry } = makeMultiProviderRegistry([anthropic])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { OM_AI_MODEL: 'claude-haiku-4-5' },
      })
      const resolution = factory.resolveModel({})
      expect(resolution.source).toBe('env_default')
      expect(resolution.modelId).toBe('claude-haiku-4-5')
      expect(resolution.providerId).toBe('anthropic')
    })

    it('honors both OM_AI_PROVIDER and OM_AI_MODEL together', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: {
          OM_AI_PROVIDER: 'openai',
          OM_AI_MODEL: 'gpt-5-mini',
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

    it('falls through when OM_AI_PROVIDER is registered but unconfigured', () => {
      const anthropic = makeProvider({ id: 'anthropic', isConfigured: () => true })
      const openai = makeProvider({ id: 'openai', isConfigured: () => false })
      const { registry } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: {
          OM_AI_PROVIDER: 'openai',
          OM_AI_MODEL: 'gpt-5-mini',
        },
      })
      const resolution = factory.resolveModel({})
      expect(resolution.providerId).toBe('anthropic')
      expect(resolution.modelId).toBe('gpt-5-mini')
      expect(resolution.source).toBe('env_default')
    })

    it('slash-qualified OM_AI_MODEL resets the provider for that resolution', () => {
      const anthropic = makeProvider({ id: 'anthropic' })
      const openai = makeProvider({ id: 'openai' })
      const { registry, spy } = makeMultiProviderRegistry([anthropic, openai])
      const factory = createModelFactory(fakeContainer, {
        registry,
        env: { OM_AI_MODEL: 'openai/gpt-5-mini' },
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
        env: { OM_AI_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
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
        env: { OM_AI_MODEL: 'fallback-model' },
      })
      const resolution = factory.resolveModel({ agentDefaultModel: 'agent-wins' })
      expect(resolution.modelId).toBe('agent-wins')
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
