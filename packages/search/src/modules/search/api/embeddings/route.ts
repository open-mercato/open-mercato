import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { envDisablesAutoIndexing, resolveAutoIndexingEnabled, SEARCH_AUTO_INDEX_CONFIG_KEY } from '../../lib/auto-indexing'
import {
  resolveEmbeddingConfig,
  resolveEmbeddingConfigResult,
  saveEmbeddingConfig,
  getConfiguredProviders,
  detectConfigChange,
  getEffectiveDimension,
} from '../../lib/embedding-config'
import type { EmbeddingConfigSource } from '../../lib/embedding-config'
import { localizeProviderAvailability } from '../../lib/provider-diagnostics'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { checkAllProviders } from '../../lib/provider-probe'
import type { EmbeddingProviderProbe, ProviderAvailabilityEntry } from '../../lib/provider-probe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EmbeddingProviderConfig, EmbeddingProviderId, VectorDriver } from '../../../../vector'
import { EMBEDDING_PROVIDERS, DEFAULT_EMBEDDING_CONFIG, EmbeddingService } from '../../../../vector'
import {
  assertSafeOllamaBaseUrl,
  UnsafeOllamaBaseUrlError,
} from '../../../../vector/lib/ollama-url-safety'
import { reportSearchError, searchError } from '../../../../lib/debug'
import { embeddingsOpenApi } from '../openapi'

const embeddingConfigSchema = z.object({
  providerId: z.enum(['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama']),
  model: z.string(),
  dimension: z.number(),
  outputDimensionality: z.number().optional(),
  baseUrl: z.string().optional(),
})

const updateSchema = z.object({
  autoIndexingEnabled: z.boolean().optional(),
  embeddingConfig: embeddingConfigSchema.optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.embeddings.view'] },
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

type SettingsResponse = {
  settings: {
    openaiConfigured: boolean
    autoIndexingEnabled: boolean
    autoIndexingLocked: boolean
    lockReason: string | null
    embeddingConfig: EmbeddingProviderConfig | null
    embeddingConfigSource: EmbeddingConfigSource
    configuredProviders: EmbeddingProviderId[]
    providerAvailability: ProviderAvailabilityEntry[]
    indexedDimension: number | null
    reindexRequired: boolean
    documentCount: number | null
  }
}

const openAiConfigured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0)

const toJson = (payload: SettingsResponse, init?: ResponseInit) => NextResponse.json(payload, init)

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

const configUnavailable = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('search.api.errors.configUnavailable', 'Configuration service unavailable') }, { status: 503 })
}

function resolveProbe(container: { resolve: <T = unknown>(name: string) => T }): EmbeddingProviderProbe | null {
  try {
    return container.resolve<EmbeddingProviderProbe>('embeddingProviderProbe')
  } catch {
    return null
  }
}

async function resolveProviderAvailability(
  container: { resolve: <T = unknown>(name: string) => T },
  t: TranslateFn,
): Promise<ProviderAvailabilityEntry[]> {
  const probe = resolveProbe(container)
  if (!probe) return []
  try {
    return (await checkAllProviders(probe)).map((entry) => localizeProviderAvailability(entry, t))
  } catch {
    return []
  }
}

async function getIndexedDimension(container: { resolve: <T = unknown>(name: string) => T }): Promise<number | null> {
  try {
    const drivers = container.resolve<VectorDriver[]>('vectorDrivers')
    const pgvectorDriver = drivers.find((d) => d.id === 'pgvector')
    if (pgvectorDriver?.getTableDimension) {
      return await pgvectorDriver.getTableDimension()
    }
    return null
  } catch {
    return null
  }
}

async function getVectorDocumentCount(
  container: { resolve: <T = unknown>(name: string) => T },
  tenantId: string,
  organizationId?: string | null,
): Promise<number | null> {
  try {
    const drivers = container.resolve<VectorDriver[]>('vectorDrivers')
    const pgvectorDriver = drivers.find((d) => d.id === 'pgvector')
    if (pgvectorDriver?.count) {
      return await pgvectorDriver.count({ tenantId, organizationId: organizationId ?? undefined })
    }
    return null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const lockedByEnv = envDisablesAutoIndexing()
    let autoIndexingEnabled = !lockedByEnv
    if (!lockedByEnv) {
      try {
        autoIndexingEnabled = await resolveAutoIndexingEnabled(container, { defaultValue: true, scope: { tenantId: auth.tenantId } })
      } catch {
        autoIndexingEnabled = true
      }
    }

    const { config: embeddingConfig, source: embeddingConfigSource } = await resolveEmbeddingConfigResult(container, {
      scope: { tenantId: auth.tenantId },
    })
    const configuredProviders = getConfiguredProviders()
    const providerAvailability = await resolveProviderAvailability(container, t)
    const indexedDimension = await getIndexedDimension(container)

    const effectiveDimension = embeddingConfig
      ? getEffectiveDimension(embeddingConfig)
      : DEFAULT_EMBEDDING_CONFIG.dimension

    const reindexRequired = Boolean(
      indexedDimension &&
      embeddingConfig &&
      indexedDimension !== effectiveDimension
    )

    // Get document count for vector index
    const documentCount = auth.tenantId
      ? await getVectorDocumentCount(container, auth.tenantId, auth.orgId)
      : null

    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: lockedByEnv ? false : autoIndexingEnabled,
        autoIndexingLocked: lockedByEnv,
        lockReason: lockedByEnv ? 'env' : null,
        embeddingConfig,
        embeddingConfigSource,
        configuredProviders,
        providerAvailability,
        indexedDimension,
        reindexRequired,
        documentCount,
      },
    })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: t('api.errors.invalidJson', 'Invalid JSON payload.') }, { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: t('api.errors.invalidPayload', 'Invalid payload.') }, { status: 400 })
  }

  const container = await createRequestContainer()
  try {
    let service: ModuleConfigService
    try {
      service = (container.resolve('moduleConfigService') as ModuleConfigService)
    } catch {
      return await configUnavailable()
    }

    if (parsed.data.autoIndexingEnabled !== undefined && envDisablesAutoIndexing()) {
      return NextResponse.json(
        {
          error: t(
            'search.api.errors.autoIndexingDisabled',
            'Auto-indexing is disabled via OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING (legacy alias: DISABLE_VECTOR_SEARCH_AUTOINDEXING).',
          ),
        },
        { status: 409 },
      )
    }

    let embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null, scope: { tenantId: auth.tenantId } })
    let reindexRequired = false
    const indexedDimension = await getIndexedDimension(container)

    if (parsed.data.embeddingConfig) {
      const newConfig = parsed.data.embeddingConfig
      const providerInfo = EMBEDDING_PROVIDERS[newConfig.providerId]

      if (!providerInfo) {
        return NextResponse.json(
          { error: t('search.api.errors.invalidProvider', 'Invalid embedding provider.') },
          { status: 400 },
        )
      }

      const configuredProviders = getConfiguredProviders()
      if (!configuredProviders.includes(newConfig.providerId)) {
        return NextResponse.json(
          { error: t('search.api.errors.providerNotConfigured', `Provider ${providerInfo.name} is not configured. Set ${providerInfo.envKeyRequired} environment variable.`) },
          { status: 400 },
        )
      }

      // Reject an unsafe user-supplied Ollama base URL before doing anything with it (SSRF guard).
      if (newConfig.providerId === 'ollama' && newConfig.baseUrl != null) {
        try {
          assertSafeOllamaBaseUrl(newConfig.baseUrl)
        } catch (err) {
          if (err instanceof UnsafeOllamaBaseUrlError) {
            return NextResponse.json(
              {
                error: t(
                  'search.api.errors.invalidOllamaBaseUrl',
                  'Ollama base URL is not allowed. Set OLLAMA_BASE_URL in the environment, or add the host to OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST.',
                ),
                reason: err.reason,
              },
              { status: 400 },
            )
          }
          throw err
        }
      }

      // Save-time availability guard: never persist a provider the probe reports unreachable.
      const probe = resolveProbe(container)
      if (probe) {
        const availability = await probe.checkAvailability(
          newConfig.providerId,
          newConfig.providerId === 'ollama'
            ? { force: true, baseUrl: newConfig.baseUrl }
            : undefined,
        )
        if (!availability.available) {
          const localized = localizeProviderAvailability(availability, t)
          return NextResponse.json(
            {
              error: t(
                'search.api.errors.providerUnavailable',
                'The selected provider is not available.',
              ),
              reason: localized.reason ?? null,
            },
            { status: 409 },
          )
        }
      }

      const change = detectConfigChange(
        embeddingConfig,
        {
          ...newConfig,
          updatedAt: new Date().toISOString(),
        },
        indexedDimension
      )

      const newDimension = getEffectiveDimension(change.newConfig)
      if (indexedDimension === null || !Number.isInteger(indexedDimension) || indexedDimension <= 0) {
        return NextResponse.json(
          { error: t('search.api.errors.indexUnavailable', 'Search index is unavailable.') },
          { status: 503 },
        )
      }
      if (newDimension !== indexedDimension) {
        return NextResponse.json(
          { error: t('search.api.errors.dimensionMismatch', 'The embedding dimension must match the shared vector index. Contact your instance administrator to change the index dimension.') },
          { status: 409 },
        )
      }

      embeddingConfig = change.newConfig
      reindexRequired = change.requiresReindex
    }

    if (parsed.data.embeddingConfig || parsed.data.autoIndexingEnabled !== undefined) {
      const em = container.resolve<EntityManager>('em')
      try {
        await em.transactional(async () => {
          if (parsed.data.embeddingConfig && embeddingConfig) {
            await saveEmbeddingConfig(container, embeddingConfig, { scope: { tenantId: auth.tenantId } })
          }
          if (parsed.data.autoIndexingEnabled !== undefined) {
            await service.setValue('vector', SEARCH_AUTO_INDEX_CONFIG_KEY, parsed.data.autoIndexingEnabled, { tenantId: auth.tenantId })
          }
        })
      } catch (error) {
        await service.invalidate('vector', undefined, { tenantId: auth.tenantId })
        throw error
      }
    }

    if (parsed.data.embeddingConfig && embeddingConfig) {
      try {
        const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
        embeddingService.updateConfig(embeddingConfig)
      } catch {
        // Embedding service may not be available in all contexts
      }
    }

    const lockedByEnv = envDisablesAutoIndexing()
    let autoIndexingEnabled = !lockedByEnv
    if (!lockedByEnv) {
      try {
        autoIndexingEnabled = await resolveAutoIndexingEnabled(container, { defaultValue: true, scope: { tenantId: auth.tenantId } })
      } catch {
        autoIndexingEnabled = true
      }
    }

    // Get updated document count
    const updatedDocumentCount = auth.tenantId
      ? await getVectorDocumentCount(container, auth.tenantId, auth.orgId)
      : null

    const { source: embeddingConfigSource } = await resolveEmbeddingConfigResult(container, {
      scope: { tenantId: auth.tenantId },
    })

    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: lockedByEnv ? false : autoIndexingEnabled,
        autoIndexingLocked: lockedByEnv,
        lockReason: lockedByEnv ? 'env' : null,
        embeddingConfig,
        embeddingConfigSource,
        configuredProviders: getConfiguredProviders(),
        providerAvailability: await resolveProviderAvailability(container, t),
        indexedDimension,
        reindexRequired,
        documentCount: updatedDocumentCount,
      },
    })
  } catch (error) {
    reportSearchError('search.embeddings.update', error, 'search.embedding_settings_update_failed')
    searchError('search.embeddings.update', 'failed', {
      error: error instanceof Error ? error.message : error,
    })
    return NextResponse.json({ error: t('search.api.errors.updateFailed', 'Failed to update embedding settings.') }, { status: 500 })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = embeddingsOpenApi
