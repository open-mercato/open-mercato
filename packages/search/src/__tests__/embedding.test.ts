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
