import type { AwilixContainer } from 'awilix'
import {
  AiModelFactoryError,
  createModelFactory,
  type AiModelFactoryInput,
  type CreateModelFactoryDependencies,
} from '../model-factory'

function makeProvider(overrides: Partial<{
  id: string
  defaultModel: string
  resolveApiKey: () => string | null
  createModel: (options: { modelId: string; apiKey: string }) => unknown
}> = {}) {
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
  }
}

function makeFactoryDeps(
  provider: ReturnType<typeof makeProvider> | null,
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
    // Even if an `_AI_MODEL` var is present, an absent moduleId means no
    // module-scoped env var name can be constructed, so the lookup is skipped.
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
})
