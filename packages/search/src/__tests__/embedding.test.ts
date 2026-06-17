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
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE
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

  it('aborts the in-flight request when it times out', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '5'
    let capturedSignal: AbortSignal | undefined
    mockedEmbed.mockImplementation((options) => {
      capturedSignal = (options as { abortSignal?: AbortSignal }).abortSignal
      return new Promise(() => undefined)
    })

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).rejects.toThrow('timed out')
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(true)
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

  it('rejects persisted Ollama baseUrl pointing at a private IP in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '100'

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        baseUrl: 'http://169.254.169.254/',
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).rejects.toThrow(
      /Ollama base URL rejected \(private_ip_literal\)/,
    )
    expect(mockedEmbed).not.toHaveBeenCalled()
  })

  it('allows persisted Ollama baseUrl on loopback in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '100'
    mockedEmbed.mockResolvedValue({ embedding: [0.1] } as Awaited<ReturnType<typeof embed>>)

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        baseUrl: 'http://127.0.0.1:11434',
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).resolves.toEqual([0.1])
  })
})
