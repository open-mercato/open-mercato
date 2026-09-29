import type { EnvLookup, LlmProvider, LlmCreateModelOptions } from '../llm-provider'

function makeBaseProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  const id = overrides.id ?? 'contract-provider'
  const envKeys = overrides.envKeys ?? [`${id.toUpperCase()}_API_KEY`]
  const base: LlmProvider = {
    id,
    name: `Contract Provider ${id}`,
    envKeys,
    defaultModel: 'contract-model',
    defaultModels: [{ id: 'contract-model', name: 'Contract Model', contextWindow: 8192 }],
    isConfigured(env?: EnvLookup): boolean {
      const lookup = env ?? process.env
      return envKeys.some((key) => {
        const value = lookup[key]
        return typeof value === 'string' && value.trim().length > 0
      })
    },
    resolveApiKey(): string | null {
      return null
    },
    getConfiguredEnvKey(): string {
      return envKeys[0]
    },
    createModel(options: LlmCreateModelOptions) {
      return { __kind: 'contract-model', modelId: options.modelId }
    },
  }
  return { ...base, ...overrides }
}

describe('LlmProvider contract — moderation/safety-identifier additive members', () => {
  it('treats mapEndUserIdentifier and supportsInputModeration as optional (legacy adapters)', () => {
    const provider = makeBaseProvider()
    expect(provider.mapEndUserIdentifier).toBeUndefined()
    expect(provider.supportsInputModeration).toBeUndefined()
  })

  it('accepts an optional endUserIdentifier on createModel options without changing behavior', () => {
    const provider = makeBaseProvider()
    const withIdentifier: LlmCreateModelOptions = {
      modelId: 'contract-model',
      apiKey: 'sk-test',
      endUserIdentifier: 'hashed-identifier',
    }
    expect(provider.createModel(withIdentifier)).toEqual({ __kind: 'contract-model', modelId: 'contract-model' })
  })

  it('exposes a providerOptions fragment when mapEndUserIdentifier is implemented', () => {
    const provider = makeBaseProvider({
      mapEndUserIdentifier(identifier: string) {
        return { contract: { user_id: identifier } }
      },
      supportsInputModeration: true,
    })
    expect(provider.supportsInputModeration).toBe(true)
    expect(provider.mapEndUserIdentifier?.('abc123')).toEqual({ contract: { user_id: 'abc123' } })
  })
})
