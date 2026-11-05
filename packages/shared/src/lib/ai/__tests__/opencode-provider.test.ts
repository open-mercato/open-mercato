import {
  resolveAiProviderIdFromEnv,
  resolveOpenCodeProviderId,
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  requireOpenCodeProviderApiKey,
} from '../opencode-provider'

describe('opencode provider helpers', () => {
  it('resolves provider IDs with fallback', () => {
    expect(resolveOpenCodeProviderId('openai')).toBe('openai')
    expect(resolveOpenCodeProviderId('invalid')).toBe('anthropic')
    expect(resolveOpenCodeProviderId(undefined, 'google')).toBe('google')
  })

  it('picks the first configured provider with default order', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: 'anthropic-key',
      },
    })
    expect(provider).toBe('anthropic')
  })

  it('picks the first configured provider with custom order', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        ANTHROPIC_API_KEY: 'anthropic-key',
        GOOGLE_GENERATIVE_AI_API_KEY: 'google-key',
      },
      order: ['google', 'anthropic', 'openai'],
    })
    expect(provider).toBe('google')
  })

  it('returns null when no provider is configured', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: ' ',
        GOOGLE_GENERATIVE_AI_API_KEY: '',
      },
    })
    expect(provider).toBeNull()
  })

  it('resolves default model when no overrides are set', () => {
    const model = resolveOpenCodeModel('openai', { env: {} })
    expect(model).toEqual({
      modelId: 'gpt-5-mini',
      modelWithProvider: 'openai/gpt-5-mini',
      source: 'default',
    })
  })

  it('resolves OPENCODE_MODEL when present', () => {
    const model = resolveOpenCodeModel('openai', {
      env: { OPENCODE_MODEL: 'openai/gpt-4.1-mini' },
    })
    expect(model).toEqual({
      modelId: 'gpt-4.1-mini',
      modelWithProvider: 'openai/gpt-4.1-mini',
      source: 'opencode_model',
    })
  })

  it('prefers OM_AI_MODEL over the legacy OPENCODE_MODEL', () => {
    const model = resolveOpenCodeModel('openai', {
      env: {
        OM_AI_MODEL: 'openai/gpt-5-mini',
        OPENCODE_MODEL: 'openai/gpt-4.1-mini',
      },
    })
    expect(model).toEqual({
      modelId: 'gpt-5-mini',
      modelWithProvider: 'openai/gpt-5-mini',
      source: 'om_ai_model',
    })
  })

  it('falls back to OPENCODE_MODEL when OM_AI_MODEL is unset', () => {
    const model = resolveOpenCodeModel('openai', {
      env: { OPENCODE_MODEL: 'openai/gpt-4.1-mini' },
    })
    expect(model.source).toBe('opencode_model')
    expect(model.modelId).toBe('gpt-4.1-mini')
  })

  it('prefers explicit override model over OM_AI_MODEL and OPENCODE_MODEL', () => {
    const model = resolveOpenCodeModel('openai', {
      overrideModel: 'gpt-4.1',
      env: {
        OM_AI_MODEL: 'openai/gpt-5-mini',
        OPENCODE_MODEL: 'openai/gpt-4.1-mini',
      },
    })
    expect(model).toEqual({
      modelId: 'gpt-4.1',
      modelWithProvider: 'openai/gpt-4.1',
      source: 'override',
    })
  })

  describe('resolveAiProviderIdFromEnv', () => {
    it('returns OM_AI_PROVIDER when set', () => {
      expect(resolveAiProviderIdFromEnv({ OM_AI_PROVIDER: 'anthropic' })).toBe('anthropic')
    })

    it('falls back to OPENCODE_PROVIDER when OM_AI_PROVIDER is unset', () => {
      expect(
        resolveAiProviderIdFromEnv({ OPENCODE_PROVIDER: 'google' }),
      ).toBe('google')
    })

    it('prefers OM_AI_PROVIDER over OPENCODE_PROVIDER', () => {
      expect(
        resolveAiProviderIdFromEnv({
          OM_AI_PROVIDER: 'openai',
          OPENCODE_PROVIDER: 'anthropic',
        }),
      ).toBe('openai')
    })

    it('skips unknown values and falls through to the legacy var', () => {
      expect(
        resolveAiProviderIdFromEnv({
          OM_AI_PROVIDER: 'pirate',
          OPENCODE_PROVIDER: 'google',
        }),
      ).toBe('google')
    })

    it('defaults to openai when neither var is set', () => {
      expect(resolveAiProviderIdFromEnv({})).toBe('openai')
    })
  })

  it('throws when model provider prefix conflicts with selected provider', () => {
    expect(() =>
      resolveOpenCodeModel('openai', {
        env: { OPENCODE_MODEL: 'anthropic/claude-haiku-4-5-20251001' },
      }),
    ).toThrow('does not match configured provider')
  })

  it('resolves API key from OPENCODE_ANTHROPIC_API_KEY fallback', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        ANTHROPIC_API_KEY: '',
        OPENCODE_ANTHROPIC_API_KEY: 'opencode-anthropic-key',
      },
    })
    expect(provider).toBe('anthropic')
  })

  it('primary key takes precedence over OPENCODE_* fallback', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        ANTHROPIC_API_KEY: 'primary-key',
        OPENCODE_ANTHROPIC_API_KEY: 'opencode-anthropic-key',
      },
    })
    expect(provider).toBe('anthropic')
  })

  it('OPENCODE_* fallback works for openai provider', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        OPENAI_API_KEY: '',
        OPENCODE_OPENAI_API_KEY: 'opencode-openai-key',
      },
    })
    expect(provider).toBe('openai')
  })

  it('OPENCODE_* fallback works for google provider', () => {
    const provider = resolveFirstConfiguredOpenCodeProvider({
      env: {
        GOOGLE_GENERATIVE_AI_API_KEY: '',
        OPENCODE_GOOGLE_API_KEY: 'opencode-google-key',
      },
    })
    expect(provider).toBe('google')
  })

  describe('requireOpenCodeProviderApiKey', () => {
    it('returns the API key when configured', () => {
      const key = requireOpenCodeProviderApiKey('anthropic', {
        ANTHROPIC_API_KEY: 'my-key',
      })
      expect(key).toBe('my-key')
    })

    it('returns the fallback OPENCODE_* key when primary is missing', () => {
      const key = requireOpenCodeProviderApiKey('openai', {
        OPENAI_API_KEY: '',
        OPENCODE_OPENAI_API_KEY: 'fallback-key',
      })
      expect(key).toBe('fallback-key')
    })

    it('throws with env var names for anthropic when key is missing', () => {
      expect(() => requireOpenCodeProviderApiKey('anthropic', {})).toThrow(
        'Missing API key for provider "anthropic". Set ANTHROPIC_API_KEY or OPENCODE_ANTHROPIC_API_KEY in your .env file.',
      )
    })

    it('throws with env var names for openai when key is missing', () => {
      expect(() => requireOpenCodeProviderApiKey('openai', {})).toThrow(
        'Missing API key for provider "openai". Set OPENAI_API_KEY or OPENCODE_OPENAI_API_KEY in your .env file.',
      )
    })

    it('throws with env var names for google when key is missing', () => {
      expect(() => requireOpenCodeProviderApiKey('google', {})).toThrow(
        'Missing API key for provider "google". Set GOOGLE_GENERATIVE_AI_API_KEY or OPENCODE_GOOGLE_API_KEY in your .env file.',
      )
    })
  })
})
