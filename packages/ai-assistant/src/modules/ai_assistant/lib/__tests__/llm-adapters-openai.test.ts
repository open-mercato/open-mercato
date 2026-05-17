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

  it('preset env baseURL override beats preset default for openai', () => {
    const openaiPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'openai')!
    const provider = createOpenAICompatibleProvider(openaiPreset)
    // Without override the preset baseURL is undefined (uses AI SDK default).
    const modelDefault = provider.createModel({ apiKey: 'key', modelId: 'gpt-4o-mini' })
    expect(modelDefault).toBeDefined()
    // With a per-call baseURL override the adapter must not crash.
    const modelOverride = provider.createModel({
      apiKey: 'key',
      modelId: 'gpt-4o-mini',
      baseURL: 'https://custom-proxy.example.com/v1',
    })
    expect(modelOverride).toBeDefined()
  })

  it('openai preset declares OPENAI_BASE_URL in baseURLEnvKeys', () => {
    const openaiPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'openai')!
    expect(openaiPreset.baseURLEnvKeys).toContain('OPENAI_BASE_URL')
  })

  it('deepinfra preset declares DEEPINFRA_BASE_URL in baseURLEnvKeys', () => {
    const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'deepinfra')!
    expect(preset.baseURLEnvKeys).toContain('DEEPINFRA_BASE_URL')
  })

  it('groq preset declares GROQ_BASE_URL in baseURLEnvKeys', () => {
    const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'groq')!
    expect(preset.baseURLEnvKeys).toContain('GROQ_BASE_URL')
  })

  it('together preset declares TOGETHER_BASE_URL in baseURLEnvKeys', () => {
    const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'together')!
    expect(preset.baseURLEnvKeys).toContain('TOGETHER_BASE_URL')
  })

  it('fireworks preset declares FIREWORKS_BASE_URL in baseURLEnvKeys', () => {
    const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'fireworks')!
    expect(preset.baseURLEnvKeys).toContain('FIREWORKS_BASE_URL')
  })
})

describe('OpenAI preset OPENCODE_* fallback env keys', () => {
  it('openai preset includes OPENCODE_OPENAI_API_KEY fallback', () => {
    const openaiPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'openai')
    expect(openaiPreset).toBeDefined()
    expect(openaiPreset!.envKeys).toContain('OPENAI_API_KEY')
    expect(openaiPreset!.envKeys).toContain('OPENCODE_OPENAI_API_KEY')
  })

  it('resolves API key from OPENCODE_OPENAI_API_KEY fallback', () => {
    const openaiPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'openai')
    const provider = createOpenAICompatibleProvider(openaiPreset!)
    expect(
      provider.resolveApiKey({ OPENCODE_OPENAI_API_KEY: 'opencode-key' }),
    ).toBe('opencode-key')
    expect(
      provider.resolveApiKey({
        OPENAI_API_KEY: 'primary',
        OPENCODE_OPENAI_API_KEY: 'fallback',
      }),
    ).toBe('primary')
  })
})

describe('OPENAI_COMPATIBLE_PRESETS built-in catalog', () => {
  it('ships at least 10 built-in presets including openai, openrouter, and lm-studio', () => {
    expect(OPENAI_COMPATIBLE_PRESETS.length).toBeGreaterThanOrEqual(10)
    const ids = OPENAI_COMPATIBLE_PRESETS.map((p) => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('deepinfra')
    expect(ids).toContain('groq')
    expect(ids).toContain('together')
    expect(ids).toContain('fireworks')
    expect(ids).toContain('azure')
    expect(ids).toContain('litellm')
    expect(ids).toContain('ollama')
    expect(ids).toContain('openrouter')
    expect(ids).toContain('lm-studio')
  })

  it('every preset has at least one env key', () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      expect(preset.envKeys.length).toBeGreaterThan(0)
    }
  })

  it('non-auto-detect presets have at least one model and a non-empty defaultModel', () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      if (preset.id === 'lm-studio') {
        // LM Studio deliberately uses empty defaultModel — auto-detects the
        // loaded model from the request body's model field.
        expect(preset.defaultModel).toBe('')
        expect(preset.defaultModels.length).toBe(0)
        continue
      }
      expect(preset.defaultModels.length).toBeGreaterThan(0)
      expect(preset.defaultModel.length).toBeGreaterThan(0)
    }
  })

  it('every non-auto-detect preset defaultModel exists in its defaultModels array', () => {
    for (const preset of OPENAI_COMPATIBLE_PRESETS) {
      if (preset.id === 'lm-studio') continue
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

describe('OpenRouter preset', () => {
  const openrouterPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'openrouter')!

  it('has expected shape', () => {
    expect(openrouterPreset).toBeDefined()
    expect(openrouterPreset.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(openrouterPreset.baseURLEnvKeys).toContain('OPENROUTER_BASE_URL')
    expect(openrouterPreset.envKeys).toContain('OPENROUTER_API_KEY')
    expect(openrouterPreset.defaultModel).toBe('meta-llama/llama-3.3-70b-instruct')
  })

  it('isConfigured returns true only when OPENROUTER_API_KEY is set', () => {
    const provider = createOpenAICompatibleProvider(openrouterPreset)
    expect(provider.isConfigured({ OPENROUTER_API_KEY: 'or-key' })).toBe(true)
    expect(provider.isConfigured({ OPENAI_API_KEY: 'unrelated' })).toBe(false)
    expect(provider.isConfigured({})).toBe(false)
  })

  it('getConfiguredEnvKey returns OPENROUTER_API_KEY', () => {
    const provider = createOpenAICompatibleProvider(openrouterPreset)
    expect(provider.getConfiguredEnvKey({ OPENROUTER_API_KEY: 'key' })).toBe('OPENROUTER_API_KEY')
    expect(provider.getConfiguredEnvKey({})).toBe('OPENROUTER_API_KEY')
  })

  it('createModel with default baseURL does not throw', () => {
    const provider = createOpenAICompatibleProvider(openrouterPreset)
    const model = provider.createModel({ apiKey: 'or-key', modelId: openrouterPreset.defaultModel })
    expect(model).toBeDefined()
  })

  it('createModel with per-call baseURL override does not throw', () => {
    const provider = createOpenAICompatibleProvider(openrouterPreset)
    const model = provider.createModel({
      apiKey: 'or-key',
      modelId: openrouterPreset.defaultModel,
      baseURL: 'https://my-openrouter-proxy.example.com/v1',
    })
    expect(model).toBeDefined()
  })

  it('OPENROUTER_BASE_URL env override beats preset default', () => {
    const provider = createOpenAICompatibleProvider(openrouterPreset)
    const model = provider.createModel({
      apiKey: 'or-key',
      modelId: openrouterPreset.defaultModel,
      baseURL: 'https://overridden.example.com/v1',
    })
    expect(model).toBeDefined()
  })
})

describe('LM Studio preset', () => {
  const lmStudioPreset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'lm-studio')!

  it('has expected shape with empty defaultModel', () => {
    expect(lmStudioPreset).toBeDefined()
    expect(lmStudioPreset.baseURL).toBe('http://localhost:1234/v1')
    expect(lmStudioPreset.baseURLEnvKeys).toContain('LM_STUDIO_BASE_URL')
    expect(lmStudioPreset.envKeys).toContain('LM_STUDIO_API_KEY')
    expect(lmStudioPreset.defaultModel).toBe('')
    expect(lmStudioPreset.defaultModels).toHaveLength(0)
  })

  it('isConfigured returns true when LM_STUDIO_API_KEY is set', () => {
    const provider = createOpenAICompatibleProvider(lmStudioPreset)
    expect(provider.isConfigured({ LM_STUDIO_API_KEY: 'lm-key' })).toBe(true)
    expect(provider.isConfigured({})).toBe(false)
  })

  it('getConfiguredEnvKey returns LM_STUDIO_API_KEY', () => {
    const provider = createOpenAICompatibleProvider(lmStudioPreset)
    expect(provider.getConfiguredEnvKey({})).toBe('LM_STUDIO_API_KEY')
  })

  it('createModel with empty modelId does not throw', () => {
    const provider = createOpenAICompatibleProvider(lmStudioPreset)
    const model = provider.createModel({ apiKey: 'lm-key', modelId: '' })
    expect(model).toBeDefined()
  })

  it('createModel with per-call baseURL override does not throw', () => {
    const provider = createOpenAICompatibleProvider(lmStudioPreset)
    const model = provider.createModel({
      apiKey: 'lm-key',
      modelId: '',
      baseURL: 'http://192.168.1.100:1234/v1',
    })
    expect(model).toBeDefined()
  })
})
