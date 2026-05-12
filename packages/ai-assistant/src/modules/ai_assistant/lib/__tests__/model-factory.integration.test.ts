/**
 * Step 5.16 — Phase 3 WS-D integration tests for the shared AI model
 * factory (Step 5.1).
 *
 * Pins the full four-layer resolution chain against a provider-registry
 * shim that mirrors the real `LlmProviderRegistry.resolveFirstConfigured`
 * contract. The factory is stateless and re-reads env + registry on every
 * `resolveModel` call, so we drive each scenario from the dep-injected
 * `env` + `registry` fields (the Step 5.1 test seam) rather than mutating
 * `process.env` on the shared test run. This keeps the test hermetic and
 * the env cleanup trivial.
 *
 * Scenarios (per Step 5.16 spec):
 *   - callerOverride non-empty  → wins over env + agent default + provider
 *   - env `OM_AI_<MODULE>_MODEL`   → wins over agent default + provider default
 *   - agentDefaultModel         → wins over provider default
 *   - provider default          → chosen last
 *   - no provider registered    → throws `AiModelFactoryError`
 *                                 `code: 'no_provider_configured'`
 *   - moduleId: undefined       → env-override lookup skipped (regression)
 *   - empty-string callerOverride → falls through to env, not override
 *
 * Fixture rule: every test constructs its own provider + env shim, so no
 * ordering coupling exists between scenarios.
 */
import type { AwilixContainer } from 'awilix'
import {
  AiModelFactoryError,
  createModelFactory,
  type CreateModelFactoryDependencies,
} from '../model-factory'

type FakeProvider = {
  id: string
  defaultModel: string
  resolveApiKey: () => string | null
  createModel: (options: { modelId: string; apiKey: string }) => unknown
}

function makeProvider(overrides: Partial<FakeProvider> = {}): FakeProvider {
  return {
    id: overrides.id ?? 'test-provider',
    defaultModel: overrides.defaultModel ?? 'provider-default-model',
    resolveApiKey: overrides.resolveApiKey ?? (() => 'test-api-key'),
    createModel:
      overrides.createModel ??
      ((options: { modelId: string; apiKey: string }) => ({
        kind: 'fake-model',
        modelId: options.modelId,
        apiKey: options.apiKey,
      })),
  }
}

function makeDeps(
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

const fakeContainer = {} as unknown as AwilixContainer

describe('Step 5.16 — model factory fallback chain (integration)', () => {
  it('callerOverride wins over env + agentDefaultModel + provider default', () => {
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const env = { OM_AI_INBOX_OPS_MODEL: 'env-pinned' }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned',
      callerOverride: 'caller-wins',
    })
    expect(resolution.source).toBe('caller_override')
    expect(resolution.modelId).toBe('caller-wins')
    // Verify the model plumbing received the resolved id (not a later layer).
    expect(resolution.model).toMatchObject({
      kind: 'fake-model',
      modelId: 'caller-wins',
      apiKey: 'test-api-key',
    })
  })

  it('env OM_AI_<MODULE>_MODEL wins over agentDefaultModel + provider default when moduleId is set', () => {
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const env = { OM_AI_CATALOG_MODEL: 'catalog-env-model' }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'catalog',
      agentDefaultModel: 'agent-pinned',
    })
    expect(resolution.source).toBe('module_env')
    expect(resolution.modelId).toBe('catalog-env-model')
  })

  it('agentDefaultModel wins over provider default when callerOverride + env are absent', () => {
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const factory = createModelFactory(fakeContainer, makeDeps(provider, {}))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned',
    })
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-pinned')
  })

  it('provider default is chosen last when no other source applies', () => {
    const provider = makeProvider({ defaultModel: 'provider-last-resort' })
    const factory = createModelFactory(fakeContainer, makeDeps(provider, {}))
    const resolution = factory.resolveModel({})
    expect(resolution.source).toBe('provider_default')
    expect(resolution.modelId).toBe('provider-last-resort')
  })

  it('throws AiModelFactoryError with code "no_provider_configured" when no provider is registered', () => {
    const factory = createModelFactory(fakeContainer, makeDeps(null))
    expect(() => factory.resolveModel({})).toThrow(AiModelFactoryError)
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

  it('moduleId: undefined skips the env-override lookup (regression)', () => {
    // Even if a `OM_AI_<MODULE>_MODEL` env var exists in the environment, the
    // factory does NOT construct a module-scoped env var name when moduleId
    // is undefined — it falls straight through to agentDefaultModel /
    // provider default. This guards against a past bug where `String(undefined)`
    // yielded the literal env name `"OM_AI_UNDEFINED_MODEL"`.
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const env = {
      OM_AI_INBOX_OPS_MODEL: 'should-be-ignored',
      OM_AI_UNDEFINED_MODEL: 'also-ignored',
    }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({
      agentDefaultModel: 'agent-pinned',
    })
    expect(resolution.source).toBe('agent_default')
    expect(resolution.modelId).toBe('agent-pinned')
  })

  it('empty-string callerOverride falls through to env, not treated as override', () => {
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const env = { OM_AI_INBOX_OPS_MODEL: 'env-pinned' }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned',
      callerOverride: '',
    })
    expect(resolution.source).toBe('module_env')
    expect(resolution.modelId).toBe('env-pinned')
  })

  it('whitespace-only callerOverride is treated the same as empty (falls through)', () => {
    // Defense-in-depth: a caller passing `"   "` (e.g. from a UI text input)
    // should not bypass lower-priority layers.
    const provider = makeProvider({ defaultModel: 'provider-default' })
    const env = { OM_AI_INBOX_OPS_MODEL: 'env-pinned' }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({
      moduleId: 'inbox_ops',
      agentDefaultModel: 'agent-pinned',
      callerOverride: '   ',
    })
    expect(resolution.source).toBe('module_env')
    expect(resolution.modelId).toBe('env-pinned')
  })

  it('OM_AI_PROVIDER + OM_AI_MODEL surfaces the env_default source end-to-end', () => {
    // Phase 0 of spec 2026-04-27-ai-agents-provider-model-baseurl-overrides.
    // Driving only env knobs (no agent default, no caller override, no
    // module env) — the resolution must round-trip an `env_default` source
    // and the modelId should be the `OM_AI_MODEL` value forwarded
    // verbatim to `provider.createModel`.
    const provider = makeProvider({ id: 'openai', defaultModel: 'gpt-4o-mini' })
    const env = {
      OM_AI_PROVIDER: 'openai',
      OM_AI_MODEL: 'gpt-5-mini',
    }
    const factory = createModelFactory(fakeContainer, makeDeps(provider, env))
    const resolution = factory.resolveModel({})
    expect(resolution.providerId).toBe('openai')
    expect(resolution.modelId).toBe('gpt-5-mini')
    expect(resolution.source).toBe('env_default')
    expect(resolution.model).toMatchObject({
      kind: 'fake-model',
      modelId: 'gpt-5-mini',
    })
  })
})
