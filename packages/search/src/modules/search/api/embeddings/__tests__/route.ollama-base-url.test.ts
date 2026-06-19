const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockResolveEmbeddingConfig = jest.fn()
const mockSaveEmbeddingConfig = jest.fn()
const mockGetConfiguredProviders = jest.fn()
const mockDetectConfigChange = jest.fn()
const mockGetEffectiveDimension = jest.fn()
jest.mock('../../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: (...args: unknown[]) => mockResolveEmbeddingConfig(...args),
  saveEmbeddingConfig: (...args: unknown[]) => mockSaveEmbeddingConfig(...args),
  getConfiguredProviders: (...args: unknown[]) => mockGetConfiguredProviders(...args),
  detectConfigChange: (...args: unknown[]) => mockDetectConfigChange(...args),
  getEffectiveDimension: (...args: unknown[]) => mockGetEffectiveDimension(...args),
}))

jest.mock('../../../lib/auto-indexing', () => ({
  envDisablesAutoIndexing: () => false,
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(true),
  SEARCH_AUTO_INDEX_CONFIG_KEY: 'auto_indexing_enabled',
}))

import { POST } from '../route'

const ORIGINAL_ENV = { ...process.env }

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/search/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/search/embeddings — Ollama baseUrl SSRF guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 't1',
      orgId: 'org-A',
    })

    const moduleConfigService = {
      setValue: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((name: string) => {
        if (name === 'moduleConfigService') return moduleConfigService
        if (name === 'vectorDrivers') return []
        throw new Error(`unexpected resolve(${name})`)
      }),
      dispose: jest.fn(),
    })

    mockResolveEmbeddingConfig.mockResolvedValue(null)
    mockGetConfiguredProviders.mockReturnValue(['ollama', 'openai'])
    mockGetEffectiveDimension.mockReturnValue(768)
    mockDetectConfigChange.mockImplementation((_existing: unknown, next: unknown) => ({
      newConfig: next,
      requiresReindex: false,
      reason: 'none',
    }))
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('rejects a baseUrl pointing at cloud metadata IP in production with 400', async () => {
    process.env.NODE_ENV = 'production'

    const res = await POST(
      makeReq({
        embeddingConfig: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          baseUrl: 'http://169.254.169.254/',
        },
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.reason).toBe('private_ip_literal')
    expect(mockSaveEmbeddingConfig).not.toHaveBeenCalled()
  })

  it('accepts an allowlisted host in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com:11434'

    const res = await POST(
      makeReq({
        embeddingConfig: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          baseUrl: 'http://ollama.internal.example.com:11434',
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(mockSaveEmbeddingConfig).toHaveBeenCalledTimes(1)
    const savedConfig = mockSaveEmbeddingConfig.mock.calls[0][1] as { baseUrl?: string }
    expect(savedConfig.baseUrl).toBe('http://ollama.internal.example.com:11434')
  })

  it('accepts loopback baseUrl in development', async () => {
    process.env.NODE_ENV = 'development'

    const res = await POST(
      makeReq({
        embeddingConfig: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          baseUrl: 'http://localhost:11434',
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(mockSaveEmbeddingConfig).toHaveBeenCalledTimes(1)
  })
})
