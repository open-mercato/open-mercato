import {
  createOpenAICompatibleProvider,
  type OpenAICompatiblePreset,
} from '../llm-adapters/openai'
import { OPENAI_COMPATIBLE_PRESETS } from '../openai-compatible-presets'

const DEEPINFRA_PRESET: OpenAICompatiblePreset = {
  id: 'deepinfra',
  name: 'DeepInfra',
  baseURL: 'https://api.deepinfra.com/v1/openai',
  envKeys: ['DEEPINFRA_API_KEY'],
  defaultModel: 'zai-org/GLM-5.1',
  defaultModels: [
    {
      id: 'zai-org/GLM-5.1',
      name: 'GLM-5.1',
      contextWindow: 202752,
      tags: ['flagship'],
    },
  ],
}

describe('OpenAIAdapter (OpenAI-compatible provider factory)', () => {
  it('validates preset shape at construction time', () => {
    expect(() =>
      createOpenAICompatibleProvider({
        ...DEEPINFRA_PRESET,
        id: '',
      }),
    ).toThrow('must have a non-empty id')

    expect(() =>
      createOpenAICompatibleProvider({
        ...DEEPINFRA_PRESET,
        envKeys: [],
      }),
    ).toThrow('must declare at least one env key')
  })

  it('exposes preset metadata through the LlmProvider port', () => {
    const provider = createOpenAICompatibleProvider(DEEPINFRA_PRESET)
    expect(provider.id).toBe('deepinfra')
    expect(provider.name).toBe('DeepInfra')
    expect(provider.envKeys).toEqual(['DEEPINFRA_API_KEY'])
    expect(provider.defaultModel).toBe('zai-org/GLM-5.1')
    expect(provider.defaultModels[0].id).toBe('zai-org/GLM-5.1')
  })

  it('detects configuration via the preset-specific env key', () => {
    const provider = createOpenAICompatibleProvider(DEEPINFRA_PRESET)
    expect(provider.isConfigured({ DEEPINFRA_API_KEY: 'key' })).toBe(true)
    // Unrelated env key does NOT configure the preset.
    expect(provider.isConfigured({ OPENAI_API_KEY: 'unrelated' })).toBe(
      false,
    )
    expect(provider.isConfigured({})).toBe(false)
  })

  it('resolves API key and env key name for diagnostics', () => {
    const provider = createOpenAICompatibleProvider(DEEPINFRA_PRESET)
    expect(
      provider.resolveApiKey({ DEEPINFRA_API_KEY: 'secret' }),
    ).toBe('secret')
    expect(
      provider.getConfiguredEnvKey({ DEEPINFRA_API_KEY: 'secret' }),
    ).toBe('DEEPINFRA_API_KEY')
    expect(provider.getConfiguredEnvKey({})).toBe('DEEPINFRA_API_KEY')
  })

  it('createModel returns a non-null AI SDK model instance', () => {
    const provider = createOpenAICompatibleProvider(DEEPINFRA_PRESET)
    const model = provider.createModel({
      apiKey: 'test-key',
      modelId: 'zai-org/GLM-5.1',
    })
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it('createModel honors per-call baseURL override', () => {
    const provider = createOpenAICompatibleProvider(DEEPINFRA_PRESET)
    // AI SDK does not crash when baseURL is overridden per-call.
    const model = provider.createModel({
      apiKey: 'test-key',
      modelId: 'zai-org/GLM-5.1',
      baseURL: 'https://example.com/v1',
    })
    expect(model).toBeDefined()
  })

  it('azure preset honors baseURLEnvKeys override', () => {
    const azurePreset = OPENAI_COMPATIBLE_PRESETS.find(
      (p) => p.id === 'azure',
    )
    expect(azurePreset).toBeDefined()
    expect(azurePreset?.baseURLEnvKeys).toContain('AZURE_OPENAI_BASE_URL')
    // Sanity: the adapter can be created from the preset.
    const provider = createOpenAICompatibleProvider(azurePreset!)
    expect(provider.id).toBe('azure')
  })
})

describe('OPENAI_COMPATIBLE_PRESETS built-in catalog', () => {
  it('ships at least 8 built-in presets including openai and deepinfra', () => {
    expect(OPENAI_COMPATIBLE_PRESETS.length).toBeGreaterThanOrEqual(8)
    const ids = OPENAI_COMPATIBLE_PRESETS.map((p) => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('deepinfra')
    expect(ids).toContain('groq')
    expect(ids).toContain('together')
    expect(ids).toContain('fireworks')
    expect(ids).toContain('azure')
    expect(ids).toContain('litellm')
    expect(ids).toContain('ollama')
  })

  it('every preset has at least one model and one env key', () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      expect(preset.envKeys.length).toBeGreaterThan(0)
      expect(preset.defaultModels.length).toBeGreaterThan(0)
      expect(preset.defaultModel.length).toBeGreaterThan(0)
    }
  })

  it('every preset defaultModel exists in its defaultModels array', () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      const ids = preset.defaultModels.map((m) => m.id)
      expect(ids).toContain(preset.defaultModel)
    }
  })

  it('every preset id is unique', () => {
    const ids = OPENAI_COMPATIBLE_PRESETS.map((p) => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})
