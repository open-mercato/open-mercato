jest.mock('ai', () => ({
  embed: jest.fn(),
}))

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => ({ embedding: jest.fn(() => ({})) })),
}))

jest.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: jest.fn(() => ({ textEmbeddingModel: jest.fn(() => ({})) })),
}))

jest.mock('@ai-sdk/mistral', () => ({
  createMistral: jest.fn(() => ({ textEmbeddingModel: jest.fn(() => ({})) })),
}))

jest.mock('@ai-sdk/cohere', () => ({
  createCohere: jest.fn(() => ({ textEmbeddingModel: jest.fn(() => ({})) })),
}))

jest.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: jest.fn(() => ({ embedding: jest.fn(() => ({})) })),
}))

jest.mock('ai-sdk-ollama', () => ({
  createOllama: jest.fn(() => ({ embedding: jest.fn(() => ({})) })),
}))

import { embed } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createCohere } from '@ai-sdk/cohere'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ai-sdk-ollama'
import { EmbeddingService } from '../vector/services/embedding'

const mockedEmbed = jest.mocked(embed)
const mockedCreateOpenAI = jest.mocked(createOpenAI)
const mockedCreateGoogle = jest.mocked(createGoogleGenerativeAI)
const mockedCreateMistral = jest.mocked(createMistral)
const mockedCreateCohere = jest.mocked(createCohere)
const mockedCreateBedrock = jest.mocked(createAmazonBedrock)
const mockedCreateOllama = jest.mocked(createOllama)

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

  it('loads only the selected provider and reuses its client', async () => {
    const providerCases = [
      {
        providerId: 'openai' as const,
        env: { OPENAI_API_KEY: 'openai-key' },
        factory: mockedCreateOpenAI,
      },
      {
        providerId: 'google' as const,
        env: { GOOGLE_GENERATIVE_AI_API_KEY: 'google-key' },
        factory: mockedCreateGoogle,
      },
      {
        providerId: 'mistral' as const,
        env: { MISTRAL_API_KEY: 'mistral-key' },
        factory: mockedCreateMistral,
      },
      {
        providerId: 'cohere' as const,
        env: { COHERE_API_KEY: 'cohere-key' },
        factory: mockedCreateCohere,
      },
      {
        providerId: 'bedrock' as const,
        env: {
          AWS_ACCESS_KEY_ID: 'access-key',
          AWS_SECRET_ACCESS_KEY: 'secret-key',
          AWS_REGION: 'eu-central-1',
        },
        factory: mockedCreateBedrock,
      },
      {
        providerId: 'ollama' as const,
        env: { OLLAMA_BASE_URL: 'http://localhost:11434' },
        factory: mockedCreateOllama,
      },
    ]
    const factories = providerCases.map((entry) => entry.factory)

    for (const providerCase of providerCases) {
      jest.clearAllMocks()
      process.env = { ...originalEnv, ...providerCase.env, NODE_ENV: 'test' }
      mockedEmbed.mockResolvedValue({ embedding: [0.1] } as Awaited<ReturnType<typeof embed>>)

      const service = new EmbeddingService({
        config: {
          providerId: providerCase.providerId,
          model: 'test-model',
          dimension: 128,
          updatedAt: new Date().toISOString(),
        },
      })

      expect(factories.every((factory) => factory.mock.calls.length === 0)).toBe(true)
      await expect(service.createEmbedding('first')).resolves.toEqual([0.1])
      await expect(service.createEmbedding('second')).resolves.toEqual([0.1])

      expect(providerCase.factory).toHaveBeenCalledTimes(1)
      for (const factory of factories) {
        if (factory !== providerCase.factory) expect(factory).not.toHaveBeenCalled()
      }
    }
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

  it('injects the guarded fetch transport into the Ollama SDK client', async () => {
    process.env.NODE_ENV = 'production'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '100'
    mockedEmbed.mockResolvedValue({ embedding: [0.25] } as Awaited<ReturnType<typeof embed>>)

    const service = new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        baseUrl: 'https://ollama.example.com',
        updatedAt: new Date().toISOString(),
      },
    })

    await expect(service.createEmbedding('test input')).resolves.toEqual([0.25])
    expect(mockedCreateOllama).toHaveBeenCalledWith({
      baseURL: 'https://ollama.example.com',
      fetch: expect.any(Function),
    })
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
