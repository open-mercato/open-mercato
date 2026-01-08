import {
  detectConfigChange,
  isProviderConfigured,
  getConfiguredProviders,
  getEffectiveDimension,
} from '../embedding-config'
import type { EmbeddingProviderConfig, EmbeddingProviderId } from '../../../../types'

describe('embedding-config', () => {
  describe('detectConfigChange', () => {
    const baseConfig: EmbeddingProviderConfig = {
      providerId: 'openai',
      model: 'text-embedding-3-small',
      dimension: 1536,
      updatedAt: '2024-01-01T00:00:00Z',
    }

    describe('when previousConfig is null (first time setup)', () => {
      it('does not require reindex when indexed dimension matches', () => {
        const newConfig: EmbeddingProviderConfig = {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-02T00:00:00Z',
        }

        const result = detectConfigChange(null, newConfig, 1536)

        expect(result.requiresReindex).toBe(false)
        expect(result.reason).toBeNull()
      })

      it('requires reindex when indexed dimension differs from new config', () => {
        const newConfig: EmbeddingProviderConfig = {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-02T00:00:00Z',
        }

        const result = detectConfigChange(null, newConfig, 768)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Indexed dimension (768)')
        expect(result.reason).toContain('new config (1536)')
      })

      it('does not require reindex when indexedDimension is null', () => {
        const newConfig: EmbeddingProviderConfig = {
          providerId: 'openai',
          model: 'text-embedding-3-small',
          dimension: 1536,
          updatedAt: '2024-01-02T00:00:00Z',
        }

        const result = detectConfigChange(null, newConfig, null)

        expect(result.requiresReindex).toBe(false)
        expect(result.reason).toBeNull()
      })
    })

    describe('when provider changes', () => {
      it('requires reindex', () => {
        const newConfig: EmbeddingProviderConfig = {
          providerId: 'ollama',
          model: 'nomic-embed-text',
          dimension: 768,
          updatedAt: '2024-01-02T00:00:00Z',
        }

        const result = detectConfigChange(baseConfig, newConfig)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Provider changed')
        expect(result.reason).toContain('OpenAI')
        expect(result.reason).toContain('Ollama')
      })
    })

    describe('when model changes', () => {
      it('requires reindex even with same dimension', () => {
        const newConfig: EmbeddingProviderConfig = {
          providerId: 'openai',
          model: 'text-embedding-ada-002',
          dimension: 1536,
          updatedAt: '2024-01-02T00:00:00Z',
        }

        const result = detectConfigChange(baseConfig, newConfig)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Model changed')
        expect(result.reason).toContain('text-embedding-3-small')
        expect(result.reason).toContain('text-embedding-ada-002')
      })
    })

    describe('when dimension changes', () => {
      it('requires reindex when dimension increases', () => {
        const previousConfig: EmbeddingProviderConfig = {
          ...baseConfig,
          model: 'text-embedding-3-large',
          dimension: 1024,
        }
        const newConfig: EmbeddingProviderConfig = {
          ...baseConfig,
          model: 'text-embedding-3-large',
          dimension: 3072,
        }

        const result = detectConfigChange(previousConfig, newConfig)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Dimension changed')
      })

      it('requires reindex when outputDimensionality changes', () => {
        const previousConfig: EmbeddingProviderConfig = {
          ...baseConfig,
          model: 'text-embedding-3-large',
          dimension: 3072,
          outputDimensionality: 1024,
        }
        const newConfig: EmbeddingProviderConfig = {
          ...baseConfig,
          model: 'text-embedding-3-large',
          dimension: 3072,
          outputDimensionality: 512,
        }

        const result = detectConfigChange(previousConfig, newConfig)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Dimension changed')
        expect(result.reason).toContain('1024')
        expect(result.reason).toContain('512')
      })
    })

    describe('when indexed dimension differs from config', () => {
      it('requires reindex', () => {
        const result = detectConfigChange(baseConfig, baseConfig, 768)

        expect(result.requiresReindex).toBe(true)
        expect(result.reason).toContain('Indexed dimension (768)')
        expect(result.reason).toContain('config (1536)')
      })
    })

    describe('when nothing changes', () => {
      it('does not require reindex', () => {
        const result = detectConfigChange(baseConfig, baseConfig, 1536)

        expect(result.requiresReindex).toBe(false)
        expect(result.reason).toBeNull()
      })

      it('does not require reindex when only updatedAt changes', () => {
        const newConfig: EmbeddingProviderConfig = {
          ...baseConfig,
          updatedAt: '2024-12-01T00:00:00Z',
        }

        const result = detectConfigChange(baseConfig, newConfig, 1536)

        expect(result.requiresReindex).toBe(false)
        expect(result.reason).toBeNull()
      })
    })
  })

  describe('isProviderConfigured', () => {
    const originalEnv = { ...process.env }

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('returns true for ollama without any env vars', () => {
      delete process.env.OLLAMA_BASE_URL
      expect(isProviderConfigured('ollama')).toBe(true)
    })

    it('returns true for openai when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      expect(isProviderConfigured('openai')).toBe(true)
    })

    it('returns false for openai when OPENAI_API_KEY is empty', () => {
      process.env.OPENAI_API_KEY = ''
      expect(isProviderConfigured('openai')).toBe(false)
    })

    it('returns false for openai when OPENAI_API_KEY is whitespace', () => {
      process.env.OPENAI_API_KEY = '   '
      expect(isProviderConfigured('openai')).toBe(false)
    })

    it('returns false for openai when OPENAI_API_KEY is not set', () => {
      delete process.env.OPENAI_API_KEY
      expect(isProviderConfigured('openai')).toBe(false)
    })

    it('returns true for google when GOOGLE_GENERATIVE_AI_API_KEY is set', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key'
      expect(isProviderConfigured('google')).toBe(true)
    })

    it('returns false for google when GOOGLE_GENERATIVE_AI_API_KEY is not set', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      expect(isProviderConfigured('google')).toBe(false)
    })

    it('returns true for mistral when MISTRAL_API_KEY is set', () => {
      process.env.MISTRAL_API_KEY = 'mistral-key'
      expect(isProviderConfigured('mistral')).toBe(true)
    })

    it('returns true for cohere when COHERE_API_KEY is set', () => {
      process.env.COHERE_API_KEY = 'cohere-key'
      expect(isProviderConfigured('cohere')).toBe(true)
    })

    it('returns true for bedrock when both AWS keys are set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'access-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'secret-key'
      expect(isProviderConfigured('bedrock')).toBe(true)
    })

    it('returns false for bedrock when only access key is set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'access-key'
      delete process.env.AWS_SECRET_ACCESS_KEY
      expect(isProviderConfigured('bedrock')).toBe(false)
    })

    it('returns false for unknown provider', () => {
      expect(isProviderConfigured('unknown' as EmbeddingProviderId)).toBe(false)
    })
  })

  describe('getConfiguredProviders', () => {
    const originalEnv = { ...process.env }

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('always includes ollama', () => {
      // Clear all provider env vars
      delete process.env.OPENAI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      delete process.env.MISTRAL_API_KEY
      delete process.env.COHERE_API_KEY
      delete process.env.AWS_ACCESS_KEY_ID
      delete process.env.AWS_SECRET_ACCESS_KEY

      const providers = getConfiguredProviders()

      expect(providers).toContain('ollama')
    })

    it('includes openai when configured', () => {
      process.env.OPENAI_API_KEY = 'sk-test'

      const providers = getConfiguredProviders()

      expect(providers).toContain('openai')
    })

    it('includes multiple providers when configured', () => {
      process.env.OPENAI_API_KEY = 'sk-test'
      process.env.MISTRAL_API_KEY = 'mistral-key'

      const providers = getConfiguredProviders()

      expect(providers).toContain('openai')
      expect(providers).toContain('mistral')
      expect(providers).toContain('ollama')
    })
  })

  describe('getEffectiveDimension', () => {
    it('returns dimension when outputDimensionality is not set', () => {
      const config: EmbeddingProviderConfig = {
        providerId: 'openai',
        model: 'text-embedding-3-small',
        dimension: 1536,
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(getEffectiveDimension(config)).toBe(1536)
    })

    it('returns outputDimensionality when set', () => {
      const config: EmbeddingProviderConfig = {
        providerId: 'openai',
        model: 'text-embedding-3-large',
        dimension: 3072,
        outputDimensionality: 1024,
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(getEffectiveDimension(config)).toBe(1024)
    })

    it('returns outputDimensionality even when smaller than dimension', () => {
      const config: EmbeddingProviderConfig = {
        providerId: 'openai',
        model: 'text-embedding-3-large',
        dimension: 3072,
        outputDimensionality: 256,
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(getEffectiveDimension(config)).toBe(256)
    })
  })
})
