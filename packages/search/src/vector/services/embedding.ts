import { embed } from 'ai'
import type { EmbeddingModel } from 'ai'
import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createCohere } from '@ai-sdk/cohere'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOllama } from 'ai-sdk-ollama'
import type { EmbeddingProviderId, EmbeddingProviderConfig } from '../types'
import { EMBEDDING_PROVIDERS, DEFAULT_EMBEDDING_CONFIG } from '../types'

export type EmbeddingServiceOptions = {
  apiKey?: string
  model?: string
  config?: EmbeddingProviderConfig
}

type OllamaClient = ReturnType<typeof createOllama>

type ProviderClient = ReturnType<typeof createOpenAI>
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createMistral>
  | ReturnType<typeof createCohere>
  | ReturnType<typeof createAmazonBedrock>
  | OllamaClient

export class EmbeddingService {
  private config: EmbeddingProviderConfig
  private clientCache: Map<EmbeddingProviderId, ProviderClient> = new Map()

  constructor(private readonly opts: EmbeddingServiceOptions = {}) {
    if (opts.config) {
      this.config = opts.config
    } else {
      this.config = {
        providerId: 'openai',
        model: opts.model ?? DEFAULT_EMBEDDING_CONFIG.model,
        dimension: DEFAULT_EMBEDDING_CONFIG.dimension,
        updatedAt: new Date().toISOString(),
      }
    }
  }

  updateConfig(config: EmbeddingProviderConfig): void {
    this.config = config
    this.clientCache.clear()
  }

  get currentConfig(): EmbeddingProviderConfig {
    return { ...this.config }
  }

  get dimension(): number {
    return this.config.outputDimensionality ?? this.config.dimension
  }

  get available(): boolean {
    return this.isProviderConfigured(this.config.providerId)
  }

  private isProviderConfigured(providerId: EmbeddingProviderId): boolean {
    switch (providerId) {
      case 'openai':
        return Boolean(this.opts.apiKey ?? process.env.OPENAI_API_KEY)
      case 'google':
        return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
      case 'mistral':
        return Boolean(process.env.MISTRAL_API_KEY)
      case 'cohere':
        return Boolean(process.env.COHERE_API_KEY)
      case 'bedrock':
        return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
      case 'ollama':
        return true
      default:
        return false
    }
  }

  private getClient(providerId: EmbeddingProviderId): ProviderClient {
    const cached = this.clientCache.get(providerId)
    if (cached) {
      return cached
    }

    let client: ProviderClient
    switch (providerId) {
      case 'openai': {
        const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY
        if (!apiKey) {
          throw new Error('[vector.embedding] Missing OPENAI_API_KEY environment variable')
        }
        client = createOpenAI({ apiKey })
        break
      }
      case 'google': {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
        if (!apiKey) {
          throw new Error('[vector.embedding] Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable')
        }
        client = createGoogleGenerativeAI({ apiKey })
        break
      }
      case 'mistral': {
        const apiKey = process.env.MISTRAL_API_KEY
        if (!apiKey) {
          throw new Error('[vector.embedding] Missing MISTRAL_API_KEY environment variable')
        }
        client = createMistral({ apiKey })
        break
      }
      case 'cohere': {
        const apiKey = process.env.COHERE_API_KEY
        if (!apiKey) {
          throw new Error('[vector.embedding] Missing COHERE_API_KEY environment variable')
        }
        client = createCohere({ apiKey })
        break
      }
      case 'bedrock': {
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
        if (!accessKeyId || !secretAccessKey) {
          throw new Error('[vector.embedding] Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY environment variables')
        }
        client = createAmazonBedrock({
          accessKeyId,
          secretAccessKey,
          region: process.env.AWS_REGION ?? 'us-east-1',
        })
        break
      }
      case 'ollama': {
        const baseURL = this.config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
        client = createOllama({ baseURL })
        break
      }
      default:
        throw new Error(`[vector.embedding] Unknown provider: ${providerId}`)
    }

    this.clientCache.set(providerId, client)
    return client
  }

  private getEmbeddingModel() {
    const client = this.getClient(this.config.providerId)
    const { providerId, model, outputDimensionality } = this.config

    switch (providerId) {
      case 'openai':
        return (client as ReturnType<typeof createOpenAI>).embedding(model)
      case 'google':
        return (client as ReturnType<typeof createGoogleGenerativeAI>).textEmbeddingModel(model)
      case 'mistral':
        return (client as ReturnType<typeof createMistral>).textEmbeddingModel(model)
      case 'cohere':
        return (client as ReturnType<typeof createCohere>).textEmbeddingModel(model)
      case 'bedrock':
        return (client as ReturnType<typeof createAmazonBedrock>).embedding(model)
      case 'ollama':
        return (client as OllamaClient).embedding(model)
      default:
        throw new Error(`[vector.embedding] Unknown provider: ${providerId}`)
    }
  }

  private getProviderOptions(): SharedV3ProviderOptions | undefined {
    const { providerId, outputDimensionality, model } = this.config

    if (!outputDimensionality) {
      if (providerId === 'cohere') {
        return { cohere: { inputType: 'search_document' } }
      }
      return undefined
    }

    switch (providerId) {
      case 'openai':
        if (model === 'text-embedding-3-large' || model === 'text-embedding-3-small') {
        return { openai: { dimensions: outputDimensionality } }
        }
        return undefined
      case 'google':
        return { google: { outputDimensionality } }
      case 'bedrock':
        return { bedrock: { dimensions: outputDimensionality } }
      case 'cohere':
        return { cohere: { inputType: 'search_document' } }
      default:
        return undefined
    }
  }

  async createEmbedding(input: string | string[]): Promise<number[]> {
    const merged = Array.isArray(input)
      ? input.map((part) => String(part ?? '')).filter((part) => part.length > 0).join('\n\n')
      : String(input ?? '')
    if (!merged.length) {
      throw new Error('[vector.embedding] Refusing to embed empty payload')
    }

    if (!this.available) {
      const providerInfo = EMBEDDING_PROVIDERS[this.config.providerId]
      throw new Error(`[vector.embedding] Provider ${providerInfo.name} is not configured. Set ${providerInfo.envKeyRequired} environment variable.`)
    }

    const model = this.getEmbeddingModel() as EmbeddingModel
    const providerOptions = this.getProviderOptions()

    try {
      const result = await embed({
        model,
        value: merged,
        ...(providerOptions && { providerOptions }),
      })
      const emb = Array.isArray(result.embedding)
        ? result.embedding
        : Array.from(result.embedding as ArrayLike<number>)
      return emb.map((n) => Number.isFinite(n) ? Number(n) : 0)
    } catch (err: unknown) {
      const error = err as { statusCode?: number; status?: number; response?: { status?: number; statusCode?: number; data?: { error?: { message?: string; code?: string }; message?: string } }; data?: { error?: { message?: string; code?: string } }; body?: { error?: { message?: string; code?: string } }; message?: string }
      const statusCandidate =
        error?.statusCode ?? error?.status ?? error?.response?.status ?? error?.response?.statusCode
      const status =
        typeof statusCandidate === 'number'
          ? Number.isFinite(statusCandidate) ? statusCandidate : undefined
          : typeof statusCandidate === 'string'
            ? Number.parseInt(statusCandidate, 10)
            : undefined
      const apiError = error?.data?.error ?? error?.body?.error ?? error?.response?.data?.error
      const apiMessage = apiError?.message ?? error?.response?.data?.message
      const apiCode = typeof apiError?.code === 'string' ? apiError.code : undefined
      const rawMessage = typeof apiMessage === 'string'
        ? apiMessage
        : (typeof error?.message === 'string' ? error.message : 'Embedding request failed')

      const providerInfo = EMBEDDING_PROVIDERS[this.config.providerId]
      let guidance: string
      switch (apiCode) {
        case 'insufficient_quota':
          guidance = `${providerInfo.name} usage quota exceeded. Please review your plan and billing.`
          break
        case 'invalid_api_key':
          guidance = `Invalid ${providerInfo.name} API key. Update the key and retry.`
          break
        case 'account_deactivated':
          guidance = `${providerInfo.name} account is disabled. Contact support or provide a different key.`
          break
        default:
          guidance = rawMessage.includes('https://')
            ? rawMessage
            : `${rawMessage}. Check ${providerInfo.envKeyRequired}.`
      }
      const wrapped = new Error(`[vector.embedding] ${guidance}`) as Error & { status?: number; code?: string; cause?: unknown }
      if (typeof status === 'number' && Number.isFinite(status)) {
        const normalizedStatus = status === 401 || status === 403 ? 502 : status
        if (normalizedStatus >= 400 && normalizedStatus < 600) {
          wrapped.status = normalizedStatus
        }
      }
      if (apiCode) {
        wrapped.code = apiCode
      }
      wrapped.cause = err
      throw wrapped
    }
  }
}
