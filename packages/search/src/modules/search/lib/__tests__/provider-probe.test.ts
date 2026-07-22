import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  createEmbeddingProviderProbe,
  probeOllama,
  checkAllProviders,
} from '../provider-probe'

function createContainerWithCache() {
  const store = new Map<string, unknown>()
  let sets = 0
  const cache = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      sets += 1
      store.set(key, value)
    },
    delete: async () => {},
    deleteByTags: async () => {},
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'cache') return cache
      throw new Error(`unknown token ${token}`)
    },
  } as unknown as AppContainer
  return { container, sets: () => sets }
}

function mockFetch(impl: (input: string) => Promise<Response>) {
  return jest.spyOn(globalThis, 'fetch' as never).mockImplementation(impl as never)
}

const okTags = (models: number) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ models: Array.from({ length: models }, (_, index) => ({ name: `m${index}` })) }),
  }) as unknown as Response

describe('probeOllama', () => {
  afterEach(() => jest.restoreAllMocks())

  it('reports available with model count on a successful /api/tags', async () => {
    const spy = mockFetch(async () => okTags(3))
    const result = await probeOllama('http://localhost:11434')
    expect(result.available).toBe(true)
    expect(result.models).toBe(3)
    expect(spy).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.objectContaining({ method: 'GET' }))
  })

  it('reports unavailable on a non-ok response', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }) as unknown as Response)
    const result = await probeOllama('http://localhost:11434')
    expect(result.available).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('reports unavailable (timed out) when the request aborts', async () => {
    mockFetch(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const result = await probeOllama('http://localhost:11434')
    expect(result.available).toBe(false)
    expect(result.reason).toContain('timed out')
  })

  it('reports unavailable when the host is unreachable', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    const result = await probeOllama('http://localhost:11434')
    expect(result.available).toBe(false)
    expect(result.reason).toContain('not reachable')
  })
})

describe('createEmbeddingProviderProbe', () => {
  afterEach(() => jest.restoreAllMocks())

  it('caches results across calls and only probes once', async () => {
    const spy = mockFetch(async () => okTags(1))
    const { container, sets } = createContainerWithCache()
    const probe = createEmbeddingProviderProbe(container)

    const first = await probe.checkAvailability('ollama')
    const second = await probe.checkAvailability('ollama')

    expect(first.available).toBe(true)
    expect(second.available).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(sets()).toBe(1)
  })

  it('re-probes when force is set', async () => {
    const spy = mockFetch(async () => okTags(1))
    const { container } = createContainerWithCache()
    const probe = createEmbeddingProviderProbe(container)

    await probe.checkAvailability('ollama')
    await probe.checkAvailability('ollama', { force: true })

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('gates key-based providers on env-key presence', async () => {
    const { container } = createContainerWithCache()
    const probe = createEmbeddingProviderProbe(container)
    const previous = process.env.OPENAI_API_KEY

    try {
      delete process.env.OPENAI_API_KEY
      const missing = await probe.checkAvailability('openai')
      expect(missing.available).toBe(false)
      expect(missing.reason).toContain('OPENAI_API_KEY')

      process.env.OPENAI_API_KEY = 'present'
      const present = await probe.checkAvailability('openai', { force: true })
      expect(present.available).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previous
    }
  })
})

describe('checkAllProviders', () => {
  it('returns an entry for every provider with its id', async () => {
    const probe = {
      checkAvailability: async () => ({ available: false, reason: 'stub' }),
    }
    const entries = await checkAllProviders(probe)
    expect(entries.map((entry) => entry.providerId).sort()).toEqual(
      ['bedrock', 'cohere', 'google', 'mistral', 'ollama', 'openai'],
    )
    expect(entries.every((entry) => entry.available === false)).toBe(true)
  })
})
