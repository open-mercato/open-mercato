import {
  agentOverrideModelAllowlistEnvVarName,
  agentOverrideProviderAllowlistEnvVarName,
  intersectEffectiveAllowlistWithSnapshot,
  intersectAllowlists,
  isModelAllowedForProvider,
  isModelAllowedForProviderInEffective,
  isProviderAllowed,
  isProviderAllowedInEffective,
  isProviderModelAllowed,
  isProviderModelAllowedInEffective,
  modelAllowlistEnvVarName,
  providerAllowlistEnvVarName,
  readAgentRuntimeOverrideAllowlist,
  readAllowedModels,
  readAllowedProviders,
  readAllowlistConfig,
} from '../model-allowlist'

describe('model-allowlist', () => {
  describe('readAllowedProviders', () => {
    it('returns null when OM_AI_AVAILABLE_PROVIDERS is unset', () => {
      expect(readAllowedProviders({})).toBeNull()
    })

    it('returns null when OM_AI_AVAILABLE_PROVIDERS is blank or whitespace-only', () => {
      expect(readAllowedProviders({ OM_AI_AVAILABLE_PROVIDERS: '' })).toBeNull()
      expect(readAllowedProviders({ OM_AI_AVAILABLE_PROVIDERS: '   ' })).toBeNull()
    })

    it('parses a comma-separated list with whitespace tolerance', () => {
      expect(readAllowedProviders({ OM_AI_AVAILABLE_PROVIDERS: 'openai, anthropic ,google' }))
        .toEqual(['openai', 'anthropic', 'google'])
    })

    it('drops empty entries', () => {
      expect(readAllowedProviders({ OM_AI_AVAILABLE_PROVIDERS: 'openai,,anthropic, ,' }))
        .toEqual(['openai', 'anthropic'])
    })
  })

  describe('readAllowedModels', () => {
    it('returns null when no per-provider env is set', () => {
      expect(readAllowedModels({}, 'openai')).toBeNull()
    })

    it('reads from OM_AI_AVAILABLE_MODELS_<PROVIDER> uppercased', () => {
      expect(
        readAllowedModels({ OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini,gpt-5' }, 'openai'),
      ).toEqual(['gpt-5-mini', 'gpt-5'])
    })

    it('handles compound provider ids (e.g. lm-studio)', () => {
      expect(
        readAllowedModels({ OM_AI_AVAILABLE_MODELS_LM_STUDIO: 'qwen-32b' }, 'lm-studio'),
      ).toEqual(['qwen-32b'])
    })

    it('uses the same underscore env variable for underscore aliases', () => {
      expect(
        readAllowedModels({ OM_AI_AVAILABLE_MODELS_LM_STUDIO: 'qwen-32b' }, 'lm_studio'),
      ).toEqual(['qwen-32b'])
    })
  })

  describe('isProviderAllowed', () => {
    it('returns true when no restriction is configured', () => {
      expect(isProviderAllowed({}, 'openai')).toBe(true)
    })

    it('is case-insensitive for the provider id', () => {
      expect(isProviderAllowed({ OM_AI_AVAILABLE_PROVIDERS: 'OpenAI' }, 'openai')).toBe(true)
      expect(isProviderAllowed({ OM_AI_AVAILABLE_PROVIDERS: 'openai' }, 'OPENAI')).toBe(true)
    })

    it('treats hyphen and underscore provider spellings as aliases', () => {
      expect(isProviderAllowed({ OM_AI_AVAILABLE_PROVIDERS: 'lm_studio' }, 'lm-studio'))
        .toBe(true)
      expect(isProviderAllowed({ OM_AI_AVAILABLE_PROVIDERS: 'lm-studio' }, 'lm_studio'))
        .toBe(true)
    })

    it('returns false when the provider is not in the list', () => {
      expect(isProviderAllowed({ OM_AI_AVAILABLE_PROVIDERS: 'openai,anthropic' }, 'google'))
        .toBe(false)
    })
  })

  describe('isModelAllowedForProvider', () => {
    it('returns true when no per-provider restriction is configured', () => {
      expect(isModelAllowedForProvider({}, 'openai', 'gpt-5-mini')).toBe(true)
    })

    it('returns true only for case-sensitive exact model id matches', () => {
      const env = { OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini,gpt-5' }
      expect(isModelAllowedForProvider(env, 'openai', 'gpt-5-mini')).toBe(true)
      expect(isModelAllowedForProvider(env, 'openai', 'GPT-5-MINI')).toBe(false)
      expect(isModelAllowedForProvider(env, 'openai', 'gpt-4o')).toBe(false)
    })
  })

  describe('isProviderModelAllowed', () => {
    it('requires both provider and model gates to pass', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini',
      }
      expect(isProviderModelAllowed(env, 'openai', 'gpt-5-mini')).toBe(true)
      expect(isProviderModelAllowed(env, 'openai', 'gpt-4o')).toBe(false)
      expect(isProviderModelAllowed(env, 'anthropic', 'claude-haiku-4-5')).toBe(false)
    })
  })

  describe('readAllowlistConfig', () => {
    it('returns no restrictions when env is empty', () => {
      const snapshot = readAllowlistConfig({}, ['openai', 'anthropic'])
      expect(snapshot).toEqual({
        providers: null,
        modelsByProvider: {},
        hasRestrictions: false,
      })
    })

    it('aggregates per-provider model lists for known providers', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai,anthropic',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini',
      }
      const snapshot = readAllowlistConfig(env, ['openai', 'anthropic', 'google'])
      expect(snapshot.providers).toEqual(['openai', 'anthropic'])
      expect(snapshot.modelsByProvider).toEqual({ openai: ['gpt-5-mini'] })
      expect(snapshot.hasRestrictions).toBe(true)
    })
  })

  describe('public env-var-name helpers', () => {
    it('exposes the canonical env var names for docs/UI hints', () => {
      expect(providerAllowlistEnvVarName()).toBe('OM_AI_AVAILABLE_PROVIDERS')
      expect(modelAllowlistEnvVarName('openai')).toBe('OM_AI_AVAILABLE_MODELS_OPENAI')
      expect(modelAllowlistEnvVarName('lm-studio')).toBe('OM_AI_AVAILABLE_MODELS_LM_STUDIO')
      expect(agentOverrideProviderAllowlistEnvVarName('catalog.catalog_assistant'))
        .toBe('OM_AI_AGENT_CATALOG_CATALOG_ASSISTANT_AVAILABLE_PROVIDERS')
      expect(agentOverrideModelAllowlistEnvVarName('catalog.catalog_assistant', 'lm-studio'))
        .toBe('OM_AI_AGENT_CATALOG_CATALOG_ASSISTANT_AVAILABLE_MODELS_LM_STUDIO')
    })
  })

  describe('Phase 1780-6 — intersectAllowlists / effective allowlist', () => {
    it('returns env-only when no tenant snapshot is supplied', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai,anthropic',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini,gpt-5',
      }
      const effective = intersectAllowlists(env, ['openai', 'anthropic', 'google'], null)
      expect(effective.providers).toEqual(['openai', 'anthropic'])
      expect(effective.modelsByProvider).toEqual({ openai: ['gpt-5-mini', 'gpt-5'] })
      expect(effective.hasRestrictions).toBe(true)
      expect(effective.tenantOverridesActive).toBe(false)
    })

    it('clips tenant providers to the env allowlist (tenant cannot widen env)', () => {
      const env = { OM_AI_AVAILABLE_PROVIDERS: 'openai,anthropic' }
      const tenant = {
        allowedProviders: ['openai', 'google'],
        allowedModelsByProvider: {},
      }
      const effective = intersectAllowlists(env, ['openai', 'anthropic', 'google'], tenant)
      expect(effective.providers).toEqual(['openai'])
      expect(effective.tenantOverridesActive).toBe(true)
    })

    it('clips tenant models to the env per-provider allowlist (tenant cannot widen env)', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini,gpt-5',
      }
      const tenant = {
        allowedProviders: null,
        allowedModelsByProvider: { openai: ['gpt-5-mini', 'gpt-4o'] },
      }
      const effective = intersectAllowlists(env, ['openai'], tenant)
      expect(effective.providers).toEqual(['openai'])
      expect(effective.modelsByProvider.openai).toEqual(['gpt-5-mini'])
      expect(effective.tenantOverridesActive).toBe(true)
    })

    it('passes through tenant providers when env imposes no provider restriction', () => {
      const env: Record<string, string | undefined> = {}
      const tenant = {
        allowedProviders: ['openai'],
        allowedModelsByProvider: {},
      }
      const effective = intersectAllowlists(env, ['openai', 'anthropic'], tenant)
      expect(effective.providers).toEqual(['openai'])
    })

    it('returns no restriction when both env and tenant are empty', () => {
      const env: Record<string, string | undefined> = {}
      const effective = intersectAllowlists(env, ['openai'], null)
      expect(effective.providers).toBeNull()
      expect(effective.modelsByProvider).toEqual({})
      expect(effective.hasRestrictions).toBe(false)
      expect(effective.tenantOverridesActive).toBe(false)
    })

    it('isProviderAllowedInEffective is case-insensitive', () => {
      const env = { OM_AI_AVAILABLE_PROVIDERS: 'OpenAI' }
      const effective = intersectAllowlists(env, ['openai'], null)
      expect(isProviderAllowedInEffective(effective, 'openai')).toBe(true)
      expect(isProviderAllowedInEffective(effective, 'OPENAI')).toBe(true)
      expect(isProviderAllowedInEffective(effective, 'anthropic')).toBe(false)
    })

    it('isModelAllowedForProviderInEffective returns true when no per-provider list applies', () => {
      const effective = intersectAllowlists({}, ['openai'], null)
      expect(isModelAllowedForProviderInEffective(effective, 'openai', 'any-model')).toBe(true)
    })

    it('isModelAllowedForProviderInEffective is case-sensitive on model id', () => {
      const env = { OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini' }
      const effective = intersectAllowlists(env, ['openai'], null)
      expect(isModelAllowedForProviderInEffective(effective, 'openai', 'gpt-5-mini')).toBe(true)
      expect(isModelAllowedForProviderInEffective(effective, 'openai', 'GPT-5-MINI')).toBe(false)
    })

    it('isProviderModelAllowedInEffective enforces both provider and model allowlists', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini',
      }
      const effective = intersectAllowlists(env, ['openai'], null)
      expect(isProviderModelAllowedInEffective(effective, 'openai', 'gpt-5-mini')).toBe(true)
      expect(isProviderModelAllowedInEffective(effective, 'openai', 'gpt-4o')).toBe(false)
      expect(isProviderModelAllowedInEffective(effective, 'anthropic', 'claude-haiku-4-5')).toBe(false)
    })

    it('canonicalizes hyphen and underscore provider aliases for tenant intersections', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'lm_studio',
        OM_AI_AVAILABLE_MODELS_LM_STUDIO: 'qwen/qwen3.5-9b',
      }
      const tenant = {
        allowedProviders: ['lm-studio'],
        allowedModelsByProvider: {
          lm_studio: ['qwen/qwen3.5-9b'],
        },
      }
      const effective = intersectAllowlists(env, ['lm-studio'], tenant)

      expect(effective.providers).toEqual(['lm-studio'])
      expect(effective.modelsByProvider['lm-studio']).toEqual(['qwen/qwen3.5-9b'])
      expect(isProviderModelAllowedInEffective(effective, 'lm_studio', 'qwen/qwen3.5-9b'))
        .toBe(true)
      expect(isProviderModelAllowedInEffective(effective, 'lm-studio', 'qwen/qwen3.5-9b'))
        .toBe(true)
    })

    it('intersects per-agent chat override env and settings with the effective allowlist', () => {
      const env = {
        OM_AI_AVAILABLE_PROVIDERS: 'openai,anthropic',
        OM_AI_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini,gpt-4o',
        OM_AI_AGENT_CATALOG_CATALOG_ASSISTANT_AVAILABLE_PROVIDERS: 'openai',
        OM_AI_AGENT_CATALOG_CATALOG_ASSISTANT_AVAILABLE_MODELS_OPENAI: 'gpt-5-mini',
      }
      const base = intersectAllowlists(env, ['openai', 'anthropic'], {
        allowedProviders: ['openai', 'anthropic'],
        allowedModelsByProvider: { openai: ['gpt-5-mini', 'gpt-4o'] },
      })
      const agentEnv = readAgentRuntimeOverrideAllowlist(
        env,
        'catalog.catalog_assistant',
        ['openai', 'anthropic'],
      )
      const effective = intersectEffectiveAllowlistWithSnapshot(
        intersectEffectiveAllowlistWithSnapshot(base, ['openai', 'anthropic'], agentEnv),
        ['openai', 'anthropic'],
        {
          allowedProviders: ['openai', 'anthropic'],
          allowedModelsByProvider: { openai: ['gpt-4o', 'gpt-5-mini'] },
        },
      )

      expect(effective.providers).toEqual(['openai'])
      expect(effective.modelsByProvider.openai).toEqual(['gpt-5-mini'])
      expect(isProviderModelAllowedInEffective(effective, 'openai', 'gpt-5-mini')).toBe(true)
      expect(isProviderModelAllowedInEffective(effective, 'openai', 'gpt-4o')).toBe(false)
      expect(isProviderAllowedInEffective(effective, 'anthropic')).toBe(false)
    })
  })
})
