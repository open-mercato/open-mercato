jest.mock('ai', () => ({
  embed: jest.fn(),
}))

jest.mock('ai-sdk-ollama', () => ({
  createOllama: jest.fn(() => ({ embedding: jest.fn(() => ({})) })),
}))

import { embed } from 'ai'
import { createOllama } from 'ai-sdk-ollama'
import { EmbeddingService } from '../vector/services/embedding'

const mockedEmbed = jest.mocked(embed)
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
      '[vector.embedding] Ollama (Local) embedding request exceeded the 5ms deadline ' +
        '(VECTOR_EMBEDDING_TIMEOUT_MS) before the provider answered.',
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

    await expect(service.createEmbedding('test input')).rejects.toThrow('exceeded the 5ms deadline')
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

describe('EmbeddingService retry budget and error classification', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '100'
    delete process.env.VECTOR_EMBEDDING_MAX_RETRIES
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const service = () =>
    new EmbeddingService({
      config: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: new Date().toISOString(),
      },
    })

  const retryWrapped = (inner: unknown) =>
    Object.assign(new Error('Failed after 3 attempts. Last error: quota'), {
      name: 'AI_RetryError',
      lastError: inner,
      errors: [inner],
    })

  const quotaApiError = () =>
    Object.assign(new Error('You exceeded your current quota.'), {
      name: 'AI_APICallError',
      statusCode: 429,
      data: {
        error: {
          message: 'You exceeded your current quota, please check your plan and billing details.',
          code: 'insufficient_quota',
        },
      },
    })

  it('does not retry by default, so the deadline cannot pre-empt the provider error', async () => {
    mockedEmbed.mockResolvedValue({ embedding: [0.1] } as Awaited<ReturnType<typeof embed>>)

    await expect(service().createEmbedding('test input')).resolves.toEqual([0.1])
    expect(mockedEmbed).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })

  it('honours VECTOR_EMBEDDING_MAX_RETRIES when an operator raises the deadline too', async () => {
    process.env.VECTOR_EMBEDDING_MAX_RETRIES = '2'
    mockedEmbed.mockResolvedValue({ embedding: [0.1] } as Awaited<ReturnType<typeof embed>>)

    await expect(service().createEmbedding('test input')).resolves.toEqual([0.1])
    expect(mockedEmbed).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }))
  })

  it.each([['not-a-number'], ['-1'], ['']])(
    'falls back to no retries for the invalid value %p',
    async (raw) => {
      process.env.VECTOR_EMBEDDING_MAX_RETRIES = raw
      mockedEmbed.mockResolvedValue({ embedding: [0.1] } as Awaited<ReturnType<typeof embed>>)

      await expect(service().createEmbedding('test input')).resolves.toEqual([0.1])
      expect(mockedEmbed).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
    },
  )

  it('classifies a provider error that arrives unwrapped', async () => {
    mockedEmbed.mockRejectedValue(quotaApiError())

    await expect(service().createEmbedding('test input')).rejects.toMatchObject({
      message: '[vector.embedding] Ollama (Local) usage quota exceeded. Please review your plan and billing.',
      code: 'insufficient_quota',
      status: 429,
    })
  })

  it('classifies a provider error the SDK wrapped in AI_RetryError', async () => {
    // Without unwrapping, AI_RetryError's own statusCode/data are empty, the
    // switch falls through to its default branch, and a billing failure is
    // reported as "Failed after 3 attempts. ... Check OLLAMA_BASE_URL." — the
    // exact misdiagnosis this pair of changes exists to remove.
    mockedEmbed.mockRejectedValue(retryWrapped(quotaApiError()))

    await expect(service().createEmbedding('test input')).rejects.toMatchObject({
      message: '[vector.embedding] Ollama (Local) usage quota exceeded. Please review your plan and billing.',
      code: 'insufficient_quota',
      status: 429,
    })
  })

  it('unwraps through the errors array when lastError is absent', async () => {
    const inner = quotaApiError()
    mockedEmbed.mockRejectedValue(
      Object.assign(new Error('Failed after 3 attempts.'), {
        name: 'AI_RetryError',
        errors: [new Error('first attempt'), inner],
      }),
    )

    await expect(service().createEmbedding('test input')).rejects.toMatchObject({
      code: 'insufficient_quota',
      status: 429,
    })
  })

  it('keeps the original error as cause, not the unwrapped one', async () => {
    const wrapper = retryWrapped(quotaApiError())
    mockedEmbed.mockRejectedValue(wrapper)

    await expect(service().createEmbedding('test input')).rejects.toHaveProperty('cause', wrapper)
  })

  it('leaves a non-retry error untouched', async () => {
    mockedEmbed.mockRejectedValue(
      Object.assign(new Error('socket hang up'), { name: 'TypeError' }),
    )

    await expect(service().createEmbedding('test input')).rejects.toThrow(
      '[vector.embedding] socket hang up. Check OLLAMA_BASE_URL.',
    )
  })

  it('reports a timeout as a deadline rather than blaming the provider credential', async () => {
    process.env.VECTOR_EMBEDDING_TIMEOUT_MS = '5'
    mockedEmbed.mockImplementation(() => new Promise(() => undefined))

    const err = await service().createEmbedding('test input').catch((e: Error) => e)
    expect(err.message).toContain('exceeded the 5ms deadline (VECTOR_EMBEDDING_TIMEOUT_MS)')
    expect(err.message).toContain('That is a deadline, not a diagnosis')
    // The point of the change: no unevidenced "Check <ENV KEY>" claim, and no
    // doubled prefix from the classifier's default branch.
    expect(err.message).not.toContain('Check OLLAMA_BASE_URL')
    expect(err.message.match(/\[vector\.embedding\] /g)).toHaveLength(1)
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
