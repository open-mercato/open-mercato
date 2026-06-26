import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EmbeddingProviderId } from '../../../vector'
import { EMBEDDING_PROVIDERS } from '../../../vector'

const CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 30_000
const OLLAMA_PROBE_TIMEOUT_MS = 1500

export type ProviderAvailability = {
  available: boolean
  reason?: string
  models?: number
}

export type ProviderAvailabilityEntry = ProviderAvailability & {
  providerId: EmbeddingProviderId
}

export type EmbeddingProviderProbe = {
  checkAvailability(providerId: EmbeddingProviderId, options?: { force?: boolean }): Promise<ProviderAvailability>
}

const ALL_PROVIDERS: EmbeddingProviderId[] = ['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama']

export async function checkAllProviders(
  probe: EmbeddingProviderProbe,
  options?: { force?: boolean },
): Promise<ProviderAvailabilityEntry[]> {
  return Promise.all(
    ALL_PROVIDERS.map(async (providerId) => ({
      providerId,
      ...(await probe.checkAvailability(providerId, options)),
    })),
  )
}

const cacheKey = (providerId: string) => `embedding-provider-probe:${CACHE_VERSION}:${providerId}`

const resolveCache = (container: AppContainer): CacheStrategy | null => {
  try {
    return container.resolve('cache') as CacheStrategy
  } catch {
    return null
  }
}

const ollamaBaseUrl = () => process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434'

const keyPresence = (providerId: EmbeddingProviderId): ProviderAvailability => {
  const info = EMBEDDING_PROVIDERS[providerId]
  const envKey = info?.envKeyRequired
  switch (providerId) {
    case 'openai':
      return process.env.OPENAI_API_KEY?.trim()
        ? { available: true }
        : { available: false, reason: `Set ${envKey} to enable ${info?.name ?? providerId}` }
    case 'google':
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
        ? { available: true }
        : { available: false, reason: `Set ${envKey} to enable ${info?.name ?? providerId}` }
    case 'mistral':
      return process.env.MISTRAL_API_KEY?.trim()
        ? { available: true }
        : { available: false, reason: `Set ${envKey} to enable ${info?.name ?? providerId}` }
    case 'cohere':
      return process.env.COHERE_API_KEY?.trim()
        ? { available: true }
        : { available: false, reason: `Set ${envKey} to enable ${info?.name ?? providerId}` }
    case 'bedrock':
      return process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()
        ? { available: true }
        : { available: false, reason: 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to enable Bedrock' }
    default:
      return { available: false, reason: `Unknown provider: ${providerId}` }
  }
}

export async function probeOllama(baseUrl: string): Promise<ProviderAvailability> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OLLAMA_PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { available: false, reason: `Ollama responded ${response.status} at ${baseUrl}` }
    }
    let models: number | undefined
    try {
      const payload = (await response.json()) as { models?: unknown[] }
      if (Array.isArray(payload?.models)) models = payload.models.length
    } catch {}
    return { available: true, models }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      available: false,
      reason: aborted ? `Ollama not reachable at ${baseUrl} (timed out)` : `Ollama not reachable at ${baseUrl}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function computeAvailability(providerId: EmbeddingProviderId): Promise<ProviderAvailability> {
  try {
    if (providerId === 'ollama') {
      return await probeOllama(ollamaBaseUrl())
    }
    return keyPresence(providerId)
  } catch (error) {
    // Fail closed: any unexpected error means the provider is treated as unavailable.
    return { available: false, reason: error instanceof Error ? error.message : 'Availability check failed' }
  }
}

export function createEmbeddingProviderProbe(container: AppContainer): EmbeddingProviderProbe {
  const checkAvailability = async (
    providerId: EmbeddingProviderId,
    options?: { force?: boolean },
  ): Promise<ProviderAvailability> => {
    const cache = resolveCache(container)
    const key = cacheKey(providerId)
    if (!options?.force && cache) {
      try {
        const cached = await cache.get(key)
        if (cached && typeof cached === 'object' && 'available' in cached) {
          return cached as ProviderAvailability
        }
      } catch {}
    }
    const result = await computeAvailability(providerId)
    if (cache) {
      try {
        await cache.set(key, result, { ttl: CACHE_TTL_MS })
      } catch {}
    }
    return result
  }
  return { checkAvailability }
}
