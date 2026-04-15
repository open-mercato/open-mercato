import { llmProviderRegistry } from '../llm-provider-registry'
import type { EnvLookup, LlmProvider } from '../llm-provider'

function makeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  const id = overrides.id ?? 'test-provider'
  const envKeys = overrides.envKeys ?? [`${id.toUpperCase()}_API_KEY`]
  const base: LlmProvider = {
    id,
    name: overrides.name ?? `Test Provider ${id}`,
    envKeys,
    defaultModel: overrides.defaultModel ?? 'test-model',
    defaultModels: overrides.defaultModels ?? [
      { id: 'test-model', name: 'Test Model', contextWindow: 8192 },
    ],
    isConfigured(env?: EnvLookup): boolean {
      const lookup = env ?? process.env
      return envKeys.some((key) => {
        const v = lookup[key]
        return typeof v === 'string' && v.trim().length > 0
      })
    },
    resolveApiKey(env?: EnvLookup): string | null {
      const lookup = env ?? process.env
      for (const key of envKeys) {
        const value = lookup[key]
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (trimmed.length > 0) return trimmed
        }
      }
      return null
    },
    getConfiguredEnvKey(env?: EnvLookup): string {
      const lookup = env ?? process.env
      for (const key of envKeys) {
        const value = lookup[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          return key
        }
      }
      return envKeys[0]
    },
    createModel() {
      return { __kind: 'test-model', providerId: id }
    },
  }
  return { ...base, ...overrides }
}

describe('LlmProviderRegistry', () => {
  beforeEach(() => {
    llmProviderRegistry.reset()
  })

  it('registers and retrieves providers by id', () => {
    const provider = makeProvider({ id: 'alpha' })
    llmProviderRegistry.register(provider)
    expect(llmProviderRegistry.get('alpha')).toBe(provider)
    expect(llmProviderRegistry.get('missing')).toBeNull()
  })

  it('rejects providers without an id', () => {
    expect(() =>
      llmProviderRegistry.register({ ...makeProvider(), id: '' }),
    ).toThrow('Provider must have a non-empty id')
  })

  it('is idempotent: registering the same id replaces the previous entry', () => {
    const first = makeProvider({ id: 'alpha', name: 'First' })
    const second = makeProvider({ id: 'alpha', name: 'Second' })
    llmProviderRegistry.register(first)
    llmProviderRegistry.register(second)
    expect(llmProviderRegistry.get('alpha')).toBe(second)
    expect(llmProviderRegistry.list()).toHaveLength(1)
  })

  it('preserves registration order in list()', () => {
    llmProviderRegistry.register(makeProvider({ id: 'first' }))
    llmProviderRegistry.register(makeProvider({ id: 'second' }))
    llmProviderRegistry.register(makeProvider({ id: 'third' }))
    const ids = llmProviderRegistry.list().map((p) => p.id)
    expect(ids).toEqual(['first', 'second', 'third'])
  })

  it('listConfigured filters by env', () => {
    llmProviderRegistry.register(
      makeProvider({ id: 'alpha', envKeys: ['ALPHA_KEY'] }),
    )
    llmProviderRegistry.register(
      makeProvider({ id: 'beta', envKeys: ['BETA_KEY'] }),
    )
    const configured = llmProviderRegistry.listConfigured({
      ALPHA_KEY: 'configured',
      BETA_KEY: '',
    })
    expect(configured.map((p) => p.id)).toEqual(['alpha'])
  })

  it('resolveFirstConfigured walks registration order by default', () => {
    llmProviderRegistry.register(
      makeProvider({ id: 'alpha', envKeys: ['ALPHA_KEY'] }),
    )
    llmProviderRegistry.register(
      makeProvider({ id: 'beta', envKeys: ['BETA_KEY'] }),
    )
    const picked = llmProviderRegistry.resolveFirstConfigured({
      env: { ALPHA_KEY: 'a', BETA_KEY: 'b' },
    })
    expect(picked?.id).toBe('alpha')
  })

  it('resolveFirstConfigured honors explicit order argument', () => {
    llmProviderRegistry.register(
      makeProvider({ id: 'alpha', envKeys: ['ALPHA_KEY'] }),
    )
    llmProviderRegistry.register(
      makeProvider({ id: 'beta', envKeys: ['BETA_KEY'] }),
    )
    const picked = llmProviderRegistry.resolveFirstConfigured({
      env: { ALPHA_KEY: 'a', BETA_KEY: 'b' },
      order: ['beta', 'alpha'],
    })
    expect(picked?.id).toBe('beta')
  })

  it('resolveFirstConfigured falls back to registration order for providers not in order list', () => {
    llmProviderRegistry.register(
      makeProvider({ id: 'alpha', envKeys: ['ALPHA_KEY'] }),
    )
    llmProviderRegistry.register(
      makeProvider({ id: 'beta', envKeys: ['BETA_KEY'] }),
    )
    llmProviderRegistry.register(
      makeProvider({ id: 'gamma', envKeys: ['GAMMA_KEY'] }),
    )
    // beta not in order → walk order first (alpha), find nothing, then fall back.
    const picked = llmProviderRegistry.resolveFirstConfigured({
      env: { BETA_KEY: 'b', GAMMA_KEY: 'g' },
      order: ['alpha'],
    })
    // First unlisted provider with config wins.
    expect(picked?.id).toBe('beta')
  })

  it('resolveFirstConfigured returns null when nothing is configured', () => {
    llmProviderRegistry.register(
      makeProvider({ id: 'alpha', envKeys: ['ALPHA_KEY'] }),
    )
    const picked = llmProviderRegistry.resolveFirstConfigured({
      env: { ALPHA_KEY: '' },
    })
    expect(picked).toBeNull()
  })

  it('reset clears all providers', () => {
    llmProviderRegistry.register(makeProvider({ id: 'alpha' }))
    llmProviderRegistry.register(makeProvider({ id: 'beta' }))
    expect(llmProviderRegistry.list()).toHaveLength(2)
    llmProviderRegistry.reset()
    expect(llmProviderRegistry.list()).toHaveLength(0)
    expect(llmProviderRegistry.get('alpha')).toBeNull()
  })
})
