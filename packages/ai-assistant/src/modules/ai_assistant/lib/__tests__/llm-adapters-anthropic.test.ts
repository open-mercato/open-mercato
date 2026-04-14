import { createAnthropicAdapter } from '../llm-adapters/anthropic'

describe('AnthropicAdapter', () => {
  const adapter = createAnthropicAdapter()

  it('has expected id, name, envKeys and defaultModel', () => {
    expect(adapter.id).toBe('anthropic')
    expect(adapter.name).toBe('Anthropic')
    expect(adapter.envKeys).toEqual(['ANTHROPIC_API_KEY'])
    expect(adapter.defaultModel).toBe('claude-haiku-4-5-20251001')
    expect(adapter.defaultModels.length).toBeGreaterThan(0)
    expect(adapter.defaultModels[0].id).toBe('claude-haiku-4-5-20251001')
  })

  it('detects configuration from env', () => {
    expect(
      adapter.isConfigured({ ANTHROPIC_API_KEY: 'sk-ant-key' }),
    ).toBe(true)
    expect(adapter.isConfigured({ ANTHROPIC_API_KEY: '' })).toBe(false)
    expect(adapter.isConfigured({ ANTHROPIC_API_KEY: '   ' })).toBe(false)
    expect(adapter.isConfigured({})).toBe(false)
  })

  it('resolves API key from env', () => {
    expect(
      adapter.resolveApiKey({ ANTHROPIC_API_KEY: 'sk-ant-key' }),
    ).toBe('sk-ant-key')
    expect(
      adapter.resolveApiKey({ ANTHROPIC_API_KEY: '  sk-ant-key  ' }),
    ).toBe('sk-ant-key')
    expect(adapter.resolveApiKey({ ANTHROPIC_API_KEY: '' })).toBeNull()
    expect(adapter.resolveApiKey({})).toBeNull()
  })

  it('returns the configured env key name for diagnostics', () => {
    expect(
      adapter.getConfiguredEnvKey({ ANTHROPIC_API_KEY: 'sk-ant' }),
    ).toBe('ANTHROPIC_API_KEY')
    // Falls back to first declared key when none configured.
    expect(adapter.getConfiguredEnvKey({})).toBe('ANTHROPIC_API_KEY')
  })

  it('createModel returns a non-null AI SDK model instance', () => {
    const model = adapter.createModel({
      apiKey: 'sk-ant-test',
      modelId: 'claude-haiku-4-5-20251001',
    })
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })
})
