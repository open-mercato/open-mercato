import { createGoogleAdapter } from '../llm-adapters/google'

describe('GoogleAdapter', () => {
  const adapter = createGoogleAdapter()

  it('has expected id, name, envKeys and defaultModel', () => {
    expect(adapter.id).toBe('google')
    expect(adapter.name).toBe('Google')
    expect(adapter.envKeys).toEqual(['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENCODE_GOOGLE_API_KEY'])
    expect(adapter.defaultModel).toBe('gemini-3-flash')
    expect(adapter.defaultModels.length).toBeGreaterThan(0)
  })

  it('detects configuration from env', () => {
    expect(
      adapter.isConfigured({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-key' }),
    ).toBe(true)
    expect(adapter.isConfigured({})).toBe(false)
    expect(
      adapter.isConfigured({ GOOGLE_GENERATIVE_AI_API_KEY: '  ' }),
    ).toBe(false)
  })

  it('detects configuration from OPENCODE_* fallback env', () => {
    expect(
      adapter.isConfigured({ OPENCODE_GOOGLE_API_KEY: 'AIza-key' }),
    ).toBe(true)
    expect(
      adapter.isConfigured({ OPENCODE_GOOGLE_API_KEY: '' }),
    ).toBe(false)
  })

  it('resolves API key from env', () => {
    expect(
      adapter.resolveApiKey({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-key' }),
    ).toBe('AIza-key')
    expect(adapter.resolveApiKey({})).toBeNull()
  })

  it('resolves API key from OPENCODE_* fallback env', () => {
    expect(
      adapter.resolveApiKey({ OPENCODE_GOOGLE_API_KEY: 'opencode-key' }),
    ).toBe('opencode-key')
    expect(
      adapter.resolveApiKey({
        GOOGLE_GENERATIVE_AI_API_KEY: 'primary',
        OPENCODE_GOOGLE_API_KEY: 'fallback',
      }),
    ).toBe('primary')
  })

  it('returns the configured env key name for diagnostics', () => {
    expect(
      adapter.getConfiguredEnvKey({
        GOOGLE_GENERATIVE_AI_API_KEY: 'AIza',
      }),
    ).toBe('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(adapter.getConfiguredEnvKey({})).toBe(
      'GOOGLE_GENERATIVE_AI_API_KEY',
    )
  })

  it('createModel returns a non-null AI SDK model instance', () => {
    const model = adapter.createModel({
      apiKey: 'AIza-test',
      modelId: 'gemini-3-flash',
    })
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it('createModel forwards baseURL to createGoogleGenerativeAI without throwing', () => {
    const model = adapter.createModel({
      apiKey: 'AIza-test',
      modelId: 'gemini-3-flash',
      baseURL: 'https://generativelanguage-proxy.example.com/v1beta',
    })
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it('createModel without baseURL still works (Google API default)', () => {
    const model = adapter.createModel({
      apiKey: 'AIza-test',
      modelId: 'gemini-3-flash',
    })
    expect(model).toBeDefined()
  })
})
