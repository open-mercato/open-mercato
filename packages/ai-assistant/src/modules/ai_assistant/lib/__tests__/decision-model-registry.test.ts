import type { DecisionModelAdapter } from '@open-mercato/shared/lib/ai/decision-model'
import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import {
  createDecisionModelRegistry,
  decisionModuleModelEnvKey,
  isDecisionFixtureEnabled,
} from '../decision-model-registry'

const fixtureOptIn: EnvLookup = { OM_DECISION_FIXTURE_ENABLED: '1', NODE_ENV: 'test' }

function stubAdapter(id: string, configured = true): DecisionModelAdapter {
  return {
    id,
    isConfigured: () => configured,
    decide: async () => {
      throw new Error('[internal] not used')
    },
  }
}

describe('decisionModuleModelEnvKey', () => {
  it('uppercases the module id and replaces non-alphanumerics with underscores', () => {
    expect(decisionModuleModelEnvKey('workflows')).toBe('OM_DECISION_WORKFLOWS_MODEL')
    expect(decisionModuleModelEnvKey('inbox-ops.x')).toBe('OM_DECISION_INBOX_OPS_X_MODEL')
    expect(decisionModuleModelEnvKey('sales_2')).toBe('OM_DECISION_SALES_2_MODEL')
  })
})

describe('isDecisionFixtureEnabled', () => {
  it('requires the opt-in flag and a non-production NODE_ENV', () => {
    expect(isDecisionFixtureEnabled({})).toBe(false)
    expect(isDecisionFixtureEnabled({ OM_DECISION_FIXTURE_ENABLED: '1', NODE_ENV: 'test' })).toBe(true)
    expect(isDecisionFixtureEnabled({ OM_DECISION_FIXTURE_ENABLED: 'true', NODE_ENV: 'development' })).toBe(true)
    expect(isDecisionFixtureEnabled({ OM_DECISION_FIXTURE_ENABLED: '1' })).toBe(true)
    expect(isDecisionFixtureEnabled({ OM_DECISION_FIXTURE_ENABLED: '0', NODE_ENV: 'test' })).toBe(false)
    expect(isDecisionFixtureEnabled({ OM_DECISION_FIXTURE_ENABLED: '1', NODE_ENV: 'production' })).toBe(false)
  })
})

describe('createDecisionModelRegistry', () => {
  it('registers openrouter only by default', () => {
    const registry = createDecisionModelRegistry({ env: {} })
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['openrouter'])
    expect(registry.get('fixture')).toBeUndefined()
  })

  it('registers the fixture adapter under the double opt-in', () => {
    const registry = createDecisionModelRegistry({ env: fixtureOptIn })
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['openrouter', 'fixture'])
  })

  it('does not register the fixture adapter in production', () => {
    const registry = createDecisionModelRegistry({
      env: { OM_DECISION_FIXTURE_ENABLED: '1', NODE_ENV: 'production' },
    })
    expect(registry.get('fixture')).toBeUndefined()
  })

  it('replaces an adapter re-registered under the same id and keeps registration order', () => {
    const registry = createDecisionModelRegistry({ env: {} })
    const first = stubAdapter('custom')
    const second = stubAdapter('custom')
    registry.register(first)
    registry.register(stubAdapter('other'))
    registry.register(second)
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['openrouter', 'custom', 'other'])
    expect(registry.get('custom')).toBe(second)
  })

  describe('resolve', () => {
    const registry = createDecisionModelRegistry({ env: {} })

    it('reports not_configured when the provider is unset or blank', () => {
      expect(registry.resolve({ env: {} })).toEqual({ ok: false, reason: 'not_configured' })
      expect(registry.resolve({ env: { OM_DECISION_PROVIDER: '   ' } })).toEqual({ ok: false, reason: 'not_configured' })
    })

    it('reports unknown_provider for an unregistered provider', () => {
      expect(registry.resolve({ env: { OM_DECISION_PROVIDER: 'acme' } })).toEqual({
        ok: false,
        reason: 'unknown_provider',
      })
    })

    it('reports credentials_missing for openrouter without an API key', () => {
      expect(
        registry.resolve({ env: { OM_DECISION_PROVIDER: 'openrouter', OM_DECISION_MODEL: 'some/model' } }),
      ).toEqual({ ok: false, reason: 'credentials_missing' })
    })

    it('reports model_missing when the key is set but no model is', () => {
      expect(
        registry.resolve({ env: { OM_DECISION_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' } }),
      ).toEqual({ ok: false, reason: 'model_missing' })
    })

    it('resolves the global model', () => {
      const resolution = registry.resolve({
        env: { OM_DECISION_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key', OM_DECISION_MODEL: ' global/model ' },
      })
      expect(resolution.ok).toBe(true)
      if (!resolution.ok) return
      expect(resolution.adapter.id).toBe('openrouter')
      expect(resolution.modelId).toBe('global/model')
    })

    it('prefers the per-module model over the global one', () => {
      const resolution = registry.resolve({
        moduleId: 'workflows',
        env: {
          OM_DECISION_PROVIDER: 'openrouter',
          OPENROUTER_API_KEY: 'key',
          OM_DECISION_MODEL: 'global/model',
          OM_DECISION_WORKFLOWS_MODEL: 'workflows/model',
        },
      })
      expect(resolution).toMatchObject({ ok: true, modelId: 'workflows/model' })
    })

    it('falls back to the global model when the per-module key is unset or blank', () => {
      const env: EnvLookup = {
        OM_DECISION_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'key',
        OM_DECISION_MODEL: 'global/model',
      }
      expect(registry.resolve({ moduleId: 'workflows', env })).toMatchObject({ ok: true, modelId: 'global/model' })
      expect(
        registry.resolve({ moduleId: 'workflows', env: { ...env, OM_DECISION_WORKFLOWS_MODEL: ' ' } }),
      ).toMatchObject({ ok: true, modelId: 'global/model' })
    })

    it('reads the per-module key derived from a module id with non-alphanumerics', () => {
      const resolution = registry.resolve({
        moduleId: 'inbox-ops.x',
        env: {
          OM_DECISION_PROVIDER: 'openrouter',
          OPENROUTER_API_KEY: 'key',
          OM_DECISION_INBOX_OPS_X_MODEL: 'inbox/model',
        },
      })
      expect(resolution).toMatchObject({ ok: true, modelId: 'inbox/model' })
    })

    it('tolerates provider id case and whitespace', () => {
      const resolution = registry.resolve({
        env: { OM_DECISION_PROVIDER: '  OpenRouter ', OPENROUTER_API_KEY: 'key', OM_DECISION_MODEL: 'global/model' },
      })
      expect(resolution).toMatchObject({ ok: true, modelId: 'global/model' })
    })

    it('reports fixture_disabled when fixture is selected without the opt-in', () => {
      expect(
        registry.resolve({ env: { OM_DECISION_PROVIDER: 'fixture', OM_DECISION_MODEL: 'fixture-model' } }),
      ).toEqual({ ok: false, reason: 'fixture_disabled' })
    })
  })

  it('resolves the fixture adapter under the opt-in without an API key', () => {
    const registry = createDecisionModelRegistry({ env: fixtureOptIn })
    const resolution = registry.resolve({
      env: { ...fixtureOptIn, OM_DECISION_PROVIDER: 'fixture', OM_DECISION_MODEL: 'fixture-model' },
    })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.adapter.id).toBe('fixture')
    expect(resolution.modelId).toBe('fixture-model')
  })

  it('reports fixture_disabled when the opt-in is set under production', () => {
    const env: EnvLookup = {
      OM_DECISION_FIXTURE_ENABLED: '1',
      NODE_ENV: 'production',
      OM_DECISION_PROVIDER: 'fixture',
      OM_DECISION_MODEL: 'fixture-model',
    }
    const registry = createDecisionModelRegistry({ env })
    expect(registry.resolve()).toEqual({ ok: false, reason: 'fixture_disabled' })
  })

  it('uses the creation env when resolve receives no env', () => {
    const registry = createDecisionModelRegistry({
      env: { OM_DECISION_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key', OM_DECISION_MODEL: 'global/model' },
    })
    expect(registry.resolve()).toMatchObject({ ok: true, modelId: 'global/model' })
  })

  it('resolves a custom registered adapter by id', () => {
    const registry = createDecisionModelRegistry({ env: {} })
    const custom = stubAdapter('acme')
    registry.register(custom)
    const resolution = registry.resolve({ env: { OM_DECISION_PROVIDER: 'ACME', OM_DECISION_MODEL: 'acme-1' } })
    expect(resolution).toEqual({ ok: true, adapter: custom, modelId: 'acme-1' })
  })

  it('reports credentials_missing for an unconfigured custom adapter', () => {
    const registry = createDecisionModelRegistry({ env: {} })
    registry.register(stubAdapter('acme', false))
    expect(registry.resolve({ env: { OM_DECISION_PROVIDER: 'acme', OM_DECISION_MODEL: 'acme-1' } })).toEqual({
      ok: false,
      reason: 'credentials_missing',
    })
  })
})
