jest.mock('ai', () => ({
  embed: jest.fn(),
}))

import { embed } from 'ai'
import { EmbeddingService } from '../vector/services/embedding'

const mockedEmbed = jest.mocked(embed)

describe('EmbeddingService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('times out stalled embedding requests', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '5'
    mockedEmbed.mockImplementation(() => new Promise(() => undefined))

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).rejects.toThrow(
      '[vector.embedding] Ollama (Local) request timed out after 5ms. Check OLLAMA_BASE_URL.',
    )
  })

  it('returns embeddings when provider responds before the timeout', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '100'
    mockedEmbed.mockResolvedValue({ embedding: [0.25, 0.5, 0.75] } as Awaited<ReturnType<typeof embed>>)

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).resolves.toEqual([0.25, 0.5, 0.75])
  })
})

describe('EmbeddingService.updateConfig', () => {
  const baseConfig = {
    providerId: 'ollama' as const,
    model: 'nomic-embed-text',
    dimension: 768,
    updatedAt: '2024-01-01T00:00:00.000Z',
    baseUrl: 'http://localhost:11434',
  }

  it('is a no-op when all fields match (clientCache is not cleared)', () => {
    const service = new EmbeddingService({ config: { ...baseConfig } })
    const configBefore = service.currentConfig
    service.updateConfig({ ...baseConfig, updatedAt: '2099-01-01T00:00:00.000Z' })
    expect(service.currentConfig).toEqual(configBefore)
  })

  it('updates config and clears cache when model changes', () => {
    const service = new EmbeddingService({ config: { ...baseConfig } })
    service.updateConfig({ ...baseConfig, model: 'mxbai-embed-large' })
    expect(service.currentConfig.model).toBe('mxbai-embed-large')
  })

  it('updates config and clears cache when baseUrl changes', () => {
    const service = new EmbeddingService({ config: { ...baseConfig } })
    service.updateConfig({ ...baseConfig, baseUrl: 'http://my-ollama:11434' })
    expect(service.currentConfig.baseUrl).toBe('http://my-ollama:11434')
  })

  it('does not compare updatedAt — same config with different updatedAt is a no-op', () => {
    const service = new EmbeddingService({ config: { ...baseConfig } })
    const dimensionBefore = service.dimension
    service.updateConfig({ ...baseConfig, updatedAt: '2099-06-17T12:00:00.000Z' })
    expect(service.dimension).toBe(dimensionBefore)
    expect(service.currentConfig.updatedAt).toBe(baseConfig.updatedAt)
  })

  it('updates config when dimension changes', () => {
    const service = new EmbeddingService({ config: { ...baseConfig } })
    service.updateConfig({ ...baseConfig, dimension: 1024 })
    expect(service.dimension).toBe(1024)
  })
})
