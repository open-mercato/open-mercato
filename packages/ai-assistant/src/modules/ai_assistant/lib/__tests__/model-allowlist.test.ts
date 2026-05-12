import {
  isModelAllowedForProvider,
  isProviderAllowed,
  isProviderModelAllowed,
  modelAllowlistEnvVarName,
  providerAllowlistEnvVarName,
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

    it('handles compound provider ids (e.g. lm_studio)', () => {
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
    })
  })
})
