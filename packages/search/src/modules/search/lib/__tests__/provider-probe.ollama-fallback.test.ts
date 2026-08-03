jest.mock('../../../../vector', () => ({
  EMBEDDING_PROVIDERS: {},
}))

import { createEmbeddingProviderProbe } from '../provider-probe'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

function makeProbeContainer(): AppContainer {
  return {
    resolve: () => {
      throw new Error('no cache in test')
    },
  } as unknown as AppContainer
}

describe('provider-probe — Ollama base URL fallback (issue #3511)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    global.fetch = ORIGINAL_FETCH
  })

  it('falls back to the documented default URL when OLLAMA_BASE_URL is an empty string', async () => {
    process.env.OLLAMA_BASE_URL = ''
    const probe = createEmbeddingProviderProbe(makeProbeContainer())
    const result = await probe.checkAvailability('ollama', { force: true })
    expect(result.available).toBe(false)
    expect(result.reason).toBe('Ollama not reachable at http://localhost:11434')
  })

  it('falls back to the default URL when OLLAMA_BASE_URL is whitespace only', async () => {
    process.env.OLLAMA_BASE_URL = '   '
    const probe = createEmbeddingProviderProbe(makeProbeContainer())
    const result = await probe.checkAvailability('ollama', { force: true })
    expect(result.reason).toBe('Ollama not reachable at http://localhost:11434')
  })

  it('falls back to the default URL when OLLAMA_BASE_URL is unset', async () => {
    delete process.env.OLLAMA_BASE_URL
    const probe = createEmbeddingProviderProbe(makeProbeContainer())
    const result = await probe.checkAvailability('ollama', { force: true })
    expect(result.reason).toBe('Ollama not reachable at http://localhost:11434')
  })

  it('uses a configured OLLAMA_BASE_URL verbatim (trimmed)', async () => {
    process.env.OLLAMA_BASE_URL = '  http://ollama.example.com:11434  '
    const probe = createEmbeddingProviderProbe(makeProbeContainer())
    const result = await probe.checkAvailability('ollama', { force: true })
    expect(result.reason).toBe('Ollama not reachable at http://ollama.example.com:11434')
  })
})
