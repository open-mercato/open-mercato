import {
  resolveOpenCodeProviderId,
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
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
      modelId: 'gpt-4o-mini',
      modelWithProvider: 'openai/gpt-4o-mini',
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

  it('prefers explicit override model over OPENCODE_MODEL', () => {
    const model = resolveOpenCodeModel('openai', {
      overrideModel: 'gpt-4.1',
      env: { OPENCODE_MODEL: 'openai/gpt-4.1-mini' },
    })
    expect(model).toEqual({
      modelId: 'gpt-4.1',
      modelWithProvider: 'openai/gpt-4.1',
      source: 'override',
    })
  })

  it('throws when model provider prefix conflicts with selected provider', () => {
    expect(() =>
      resolveOpenCodeModel('openai', {
        env: { OPENCODE_MODEL: 'anthropic/claude-haiku-4-5-20251001' },
      }),
    ).toThrow('does not match configured provider')
  })
})
