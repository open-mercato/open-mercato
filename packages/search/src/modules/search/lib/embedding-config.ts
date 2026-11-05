import type { ConfigScope, ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { EmbeddingProviderConfig, EmbeddingProviderId } from '../../../vector'
import { EMBEDDING_CONFIG_KEY, EMBEDDING_PROVIDERS, DEFAULT_EMBEDDING_CONFIG } from '../../../vector'

export { EMBEDDING_CONFIG_KEY }

export type EmbeddingConfigChange = {
  previousConfig: EmbeddingProviderConfig | null
  newConfig: EmbeddingProviderConfig
  requiresReindex: boolean
  reason: string | null
}

export function detectConfigChange(
  previousConfig: EmbeddingProviderConfig | null,
  newConfig: EmbeddingProviderConfig,
  indexedDimension?: number | null
): EmbeddingConfigChange {
  const newDimension = newConfig.outputDimensionality ?? newConfig.dimension

  if (!previousConfig) {
    // First time setup - check if indexed dimension differs from new config
    if (indexedDimension !== null && indexedDimension !== undefined && indexedDimension !== newDimension) {
      return {
        previousConfig,
        newConfig,
        requiresReindex: true,
        reason: `Indexed dimension (${indexedDimension}) differs from new config (${newDimension})`,
      }
    }
    return {
      previousConfig,
      newConfig,
      requiresReindex: false,
      reason: null,
    }
  }

  const previousDimension = previousConfig.outputDimensionality ?? previousConfig.dimension

  if (previousConfig.providerId !== newConfig.providerId) {
    return {
      previousConfig,
      newConfig,
      requiresReindex: true,
      reason: `Provider changed from ${EMBEDDING_PROVIDERS[previousConfig.providerId].name} to ${EMBEDDING_PROVIDERS[newConfig.providerId].name}`,
    }
  }

  if (previousConfig.model !== newConfig.model) {
    return {
      previousConfig,
      newConfig,
      requiresReindex: true,
      reason: `Model changed from ${previousConfig.model} to ${newConfig.model}`,
    }
  }

  if (previousDimension !== newDimension) {
    return {
      previousConfig,
      newConfig,
      requiresReindex: true,
      reason: `Dimension changed from ${previousDimension} to ${newDimension}`,
    }
  }

  // Also check if indexed dimension differs from config dimension
  if (indexedDimension !== null && indexedDimension !== undefined && indexedDimension !== newDimension) {
    return {
      previousConfig,
      newConfig,
      requiresReindex: true,
      reason: `Indexed dimension (${indexedDimension}) differs from config (${newDimension})`,
    }
  }

  return {
    previousConfig,
    newConfig,
    requiresReindex: false,
    reason: null,
  }
}

export function isProviderConfigured(providerId: EmbeddingProviderId): boolean {
  switch (providerId) {
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY?.trim())
    case 'google':
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
    case 'mistral':
      return Boolean(process.env.MISTRAL_API_KEY?.trim())
    case 'cohere':
      return Boolean(process.env.COHERE_API_KEY?.trim())
    case 'bedrock':
      return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim())
    case 'ollama':
      return true
    default:
      return false
  }
}

export function getConfiguredProviders(): EmbeddingProviderId[] {
  const providers: EmbeddingProviderId[] = []
  const allProviders: EmbeddingProviderId[] = ['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama']
  for (const providerId of allProviders) {
    if (isProviderConfigured(providerId)) {
      providers.push(providerId)
    }
  }
  return providers
}

export function getEffectiveDimension(config: EmbeddingProviderConfig): number {
  return config.outputDimensionality ?? config.dimension
}

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveEmbeddingConfig(
  resolver: Resolver,
  options?: { defaultValue?: EmbeddingProviderConfig | null; scope?: ConfigScope }
): Promise<EmbeddingProviderConfig | null> {
  const fallback = options?.defaultValue ?? null
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    const value = await service.getValue<EmbeddingProviderConfig>('vector', EMBEDDING_CONFIG_KEY, {
      defaultValue: fallback,
      scope: options?.scope,
    })
    return value
  } catch {
    return fallback
  }
}

export async function saveEmbeddingConfig(
  resolver: Resolver,
  config: EmbeddingProviderConfig,
  options?: { scope?: ConfigScope }
): Promise<void> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }
  await service.setValue('vector', EMBEDDING_CONFIG_KEY, {
    ...config,
    updatedAt: new Date().toISOString(),
  }, options?.scope)
}

export function createDefaultConfig(): EmbeddingProviderConfig {
  return { ...DEFAULT_EMBEDDING_CONFIG, updatedAt: new Date().toISOString() }
}

export type EmbeddingConfigSource = 'tenant' | 'instance' | 'env'

/**
 * Compute the env-derived default embedding config: the platform default narrowed
 * to the first env-configured provider. Returns null when no provider is configured.
 */
export function getEnvDerivedEmbeddingConfig(): EmbeddingProviderConfig | null {
  const configured = getConfiguredProviders()
  if (configured.length === 0) return null
  const providerId = configured.includes(DEFAULT_EMBEDDING_CONFIG.providerId)
    ? DEFAULT_EMBEDDING_CONFIG.providerId
    : configured[0]
  if (providerId === DEFAULT_EMBEDDING_CONFIG.providerId) {
    return { ...DEFAULT_EMBEDDING_CONFIG, updatedAt: new Date().toISOString() }
  }
  const info = EMBEDDING_PROVIDERS[providerId]
  const model = info.models.find((entry) => entry.id === info.defaultModel) ?? info.models[0]
  return {
    providerId,
    model: info.defaultModel,
    dimension: model?.dimension ?? DEFAULT_EMBEDDING_CONFIG.dimension,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Resolve the embedding config together with its source discriminator:
 * `tenant` (own scoped row), `instance` (inherited global row), or `env`
 * (no stored row -> env-derived default).
 */
export async function resolveEmbeddingConfigResult(
  resolver: Resolver,
  options?: { scope?: ConfigScope },
): Promise<{ config: EmbeddingProviderConfig | null; source: EmbeddingConfigSource }> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return { config: getEnvDerivedEmbeddingConfig(), source: 'env' }
  }
  try {
    const record = await service.getRecord('vector', EMBEDDING_CONFIG_KEY, options?.scope)
    if (record && record.value) {
      return { config: record.value as EmbeddingProviderConfig, source: record.source }
    }
  } catch {}
  return { config: getEnvDerivedEmbeddingConfig(), source: 'env' }
}
