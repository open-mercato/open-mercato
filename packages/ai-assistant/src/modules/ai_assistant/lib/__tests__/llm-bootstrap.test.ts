import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import {
  registerBuiltInLlmProviders,
  resetLlmBootstrapState,
} from '../llm-bootstrap'

describe('llm-bootstrap — built-in provider registration', () => {
  beforeEach(() => {
    llmProviderRegistry.reset()
    resetLlmBootstrapState()
  })

  it('registers the three native providers and all OpenAI-compatible presets', () => {
    registerBuiltInLlmProviders()
    const ids = llmProviderRegistry.list().map((p) => p.id)

    // Native protocol adapters.
    expect(ids).toContain('anthropic')
    expect(ids).toContain('google')

    // OpenAI-compatible presets.
    expect(ids).toContain('openai')
    expect(ids).toContain('deepinfra')
    expect(ids).toContain('groq')
    expect(ids).toContain('together')
    expect(ids).toContain('fireworks')
    expect(ids).toContain('azure')
    expect(ids).toContain('litellm')
    expect(ids).toContain('ollama')

    expect(ids.length).toBeGreaterThanOrEqual(10)
  })

  it('is idempotent — calling twice does not duplicate entries', () => {
    registerBuiltInLlmProviders()
    const afterFirst = llmProviderRegistry.list().length
    registerBuiltInLlmProviders()
    const afterSecond = llmProviderRegistry.list().length
    expect(afterSecond).toBe(afterFirst)
  })

  it('re-registers after registry reset when bootstrap state is reset', () => {
    registerBuiltInLlmProviders()
    expect(llmProviderRegistry.list().length).toBeGreaterThan(0)

    llmProviderRegistry.reset()
    resetLlmBootstrapState()
    expect(llmProviderRegistry.list().length).toBe(0)

    registerBuiltInLlmProviders()
    expect(llmProviderRegistry.list().length).toBeGreaterThan(0)
  })

  it('anthropic provider comes from the AnthropicAdapter factory', () => {
    registerBuiltInLlmProviders()
    const anthropic = llmProviderRegistry.get('anthropic')
    expect(anthropic).not.toBeNull()
    expect(anthropic?.name).toBe('Anthropic')
    expect(anthropic?.envKeys).toEqual(['ANTHROPIC_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY'])
    expect(anthropic?.defaultModel).toBe('claude-haiku-4-5-20251001')
  })

  it('deepinfra provider comes from the OpenAI-compatible preset', () => {
    registerBuiltInLlmProviders()
    const deepinfra = llmProviderRegistry.get('deepinfra')
    expect(deepinfra).not.toBeNull()
    expect(deepinfra?.envKeys).toEqual(['DEEPINFRA_API_KEY'])
    expect(deepinfra?.defaultModel).toBe('zai-org/GLM-5.1')
    const modelIds = deepinfra?.defaultModels.map((m) => m.id) ?? []
    expect(modelIds).toContain('zai-org/GLM-5.1')
    expect(modelIds).toContain('Qwen/Qwen3-235B-A22B-Instruct-2507')
  })

  it('resolveFirstConfigured picks a configured provider from the registry', () => {
    registerBuiltInLlmProviders()
    const picked = llmProviderRegistry.resolveFirstConfigured({
      env: { DEEPINFRA_API_KEY: 'deepinfra-key' },
    })
    expect(picked?.id).toBe('deepinfra')
  })
})
