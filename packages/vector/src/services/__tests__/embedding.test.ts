import { EmbeddingService } from '../embedding'
import type { EmbeddingProviderConfig } from '../../types'

describe('EmbeddingService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('constructor', () => {
    it('defaults to openai provider when no config provided', () => {
      const service = new EmbeddingService()

      expect(service.currentConfig.providerId).toBe('openai')
    })

    it('uses provided model option', () => {
      const service = new EmbeddingService({ model: 'text-embedding-ada-002' })

      expect(service.currentConfig.model).toBe('text-embedding-ada-002')
    })

    it('uses provided config over defaults', () => {
      const config: EmbeddingProviderConfig = {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const service = new EmbeddingService({ config })

      expect(service.currentConfig.providerId).toBe('ollama')
      expect(service.currentConfig.model).toBe('nomic-embed-text')
      expect(service.currentConfig.dimension).toBe(768)
    })
  })

  describe('updateConfig', () => {
    it('updates the internal config', () => {
      const service = new EmbeddingService()

      service.updateConfig({
        providerId: 'google',
        model: 'text-embedding-004',
        dimension: 768,
        updatedAt: '2024-01-01T00:00:00Z',
      })

      expect(service.currentConfig.providerId).toBe('google')
      expect(service.currentConfig.model).toBe('text-embedding-004')
      expect(service.currentConfig.dimension).toBe(768)
    })

    it('clears the client cache when config changes', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      const service = new EmbeddingService()

      // Access the private client cache to verify it gets cleared
      const cacheMap = (service as any).clientCache as Map<string, unknown>

      // Force a client to be created by accessing it
      try {
        ;(service as any).getClient('openai')
      } catch {
        // Ignore errors - we just want to populate the cache
      }

      const cacheSizeBefore = cacheMap.size

      service.updateConfig({
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        updatedAt: '2024-01-01T00:00:00Z',
      })

      expect(cacheMap.size).toBe(0)
    })
  })

  describe('currentConfig getter', () => {
    it('returns a copy of the config (not the original)', () => {
      const service = new EmbeddingService()

      const config1 = service.currentConfig
      const config2 = service.currentConfig

      expect(config1).not.toBe(config2)
      expect(config1).toEqual(config2)
    })
  })

  describe('dimension getter', () => {
    it('returns dimension when outputDimensionality is not set', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.dimension).toBe(1536)
    })

    it('returns outputDimensionality when set', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-large',
          dimension: 3072,
          outputDimensionality: 1024,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.dimension).toBe(1024)
    })

    it('updates when config is updated', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.dimension).toBe(1536)

      service.updateConfig({
        providerId: 'ollama',
        model: 'all-minilm',
        dimension: 384,
        updatedAt: '2024-01-02T00:00:00Z',
      })

      expect(service.dimension).toBe(384)
    })
  })

  describe('available getter', () => {
    it('returns true for ollama (always available)', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)
    })

    it('returns true for openai when API key is provided via constructor', () => {
      const service = new EmbeddingService({
        apiKey: 'sk-test-key',
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)
    })

    it('returns true for openai when API key is in env', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'

      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)
    })

    it('returns false for openai when API key is not set', () => {
      delete process.env.OPENAI_API_KEY

      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(false)
    })

    it('returns false for google when API key is not set', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const service = new EmbeddingService({
        config: {
          providerId: 'google',
          model: 'text-embedding-004',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(false)
    })

    it('returns true for google when API key is set', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key'

      const service = new EmbeddingService({
        config: {
          providerId: 'google',
          model: 'text-embedding-004',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)
    })

    it('reflects config changes after updateConfig', () => {
      process.env.OPENAI_API_KEY = 'sk-test'
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const service = new EmbeddingService({
        config: {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)

      service.updateConfig({
        providerId: 'google',
        model: 'text-embedding-004',
        dimension: 768,
        updatedAt: '2024-01-02T00:00:00Z',
      })

      expect(service.available).toBe(false)
    })
  })

  describe('isProviderConfigured (private method)', () => {
    it('returns false for bedrock when only one AWS key is set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'access-key'
      delete process.env.AWS_SECRET_ACCESS_KEY

      const service = new EmbeddingService({
        config: {
          providerId: 'bedrock',
          model: 'amazon.titan-embed-text-v2:0',
          dimension: 1024,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(false)
    })

    it('returns true for bedrock when both AWS keys are set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'access-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'secret-key'

      const service = new EmbeddingService({
        config: {
          providerId: 'bedrock',
          model: 'amazon.titan-embed-text-v2:0',
          dimension: 1024,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      expect(service.available).toBe(true)
    })
  })

  describe('getClient (private method)', () => {
    it('throws error for openai when API key is missing', () => {
      delete process.env.OPENAI_API_KEY

      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('openai')
      }).toThrow('Missing OPENAI_API_KEY')
    })

    it('throws error for google when API key is missing', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('google')
      }).toThrow('Missing GOOGLE_GENERATIVE_AI_API_KEY')
    })

    it('throws error for mistral when API key is missing', () => {
      delete process.env.MISTRAL_API_KEY

      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('mistral')
      }).toThrow('Missing MISTRAL_API_KEY')
    })

    it('throws error for cohere when API key is missing', () => {
      delete process.env.COHERE_API_KEY

      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('cohere')
      }).toThrow('Missing COHERE_API_KEY')
    })

    it('throws error for bedrock when AWS keys are missing', () => {
      delete process.env.AWS_ACCESS_KEY_ID
      delete process.env.AWS_SECRET_ACCESS_KEY

      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('bedrock')
      }).toThrow('Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY')
    })

    it('throws error for unknown provider', () => {
      const service = new EmbeddingService()

      expect(() => {
        ;(service as any).getClient('unknown')
      }).toThrow('Unknown provider: unknown')
    })

    it('caches client instances', () => {
      process.env.OPENAI_API_KEY = 'sk-test'

      const service = new EmbeddingService()

      const client1 = (service as any).getClient('openai')
      const client2 = (service as any).getClient('openai')

      expect(client1).toBe(client2)
    })

    it('creates ollama client with default baseURL', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      // Should not throw
      const client = (service as any).getClient('ollama')
      expect(client).toBeDefined()
    })

    it('creates ollama client with custom baseURL from config', () => {
      const service = new EmbeddingService({
        config: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          baseUrl: 'http://custom-host:11434',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      // Should not throw
      const client = (service as any).getClient('ollama')
      expect(client).toBeDefined()
    })

    it('creates ollama client with baseURL from env', () => {
      process.env.OLLAMA_BASE_URL = 'http://env-host:11434'

      const service = new EmbeddingService({
        config: {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      // Should not throw
      const client = (service as any).getClient('ollama')
      expect(client).toBeDefined()
    })
  })
})
