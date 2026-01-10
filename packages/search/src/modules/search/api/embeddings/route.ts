import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { envDisablesAutoIndexing, resolveAutoIndexingEnabled, SEARCH_AUTO_INDEX_CONFIG_KEY } from '../../lib/auto-indexing'
import {
  resolveEmbeddingConfig,
  saveEmbeddingConfig,
  getConfiguredProviders,
  detectConfigChange,
  getEffectiveDimension,
} from '../../lib/embedding-config'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EmbeddingProviderConfig, EmbeddingProviderId, VectorDriver } from '../../../../vector'
import { EMBEDDING_PROVIDERS, DEFAULT_EMBEDDING_CONFIG, EmbeddingService } from '../../../../vector'
import { searchDebug, searchDebugWarn, searchError } from '../../../../lib/debug'

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
    configuredProviders: EmbeddingProviderId[]
    indexedDimension: number | null
    reindexRequired: boolean
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

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const lockedByEnv = envDisablesAutoIndexing()
    let autoIndexingEnabled = !lockedByEnv
    if (!lockedByEnv) {
      try {
        autoIndexingEnabled = await resolveAutoIndexingEnabled(container, { defaultValue: true })
      } catch {
        autoIndexingEnabled = true
      }
    }

    const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
    const configuredProviders = getConfiguredProviders()
    const indexedDimension = await getIndexedDimension(container)

    const effectiveDimension = embeddingConfig
      ? getEffectiveDimension(embeddingConfig)
      : DEFAULT_EMBEDDING_CONFIG.dimension

    const reindexRequired = Boolean(
      indexedDimension &&
      embeddingConfig &&
      indexedDimension !== effectiveDimension
    )

    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: lockedByEnv ? false : autoIndexingEnabled,
        autoIndexingLocked: lockedByEnv,
        lockReason: lockedByEnv ? 'env' : null,
        embeddingConfig,
        configuredProviders,
        indexedDimension,
        reindexRequired,
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

    if (parsed.data.autoIndexingEnabled !== undefined) {
      if (envDisablesAutoIndexing()) {
        return NextResponse.json(
          { error: t('search.api.errors.autoIndexingDisabled', 'Auto-indexing is disabled via DISABLE_VECTOR_SEARCH_AUTOINDEXING.') },
          { status: 409 },
        )
      }
      await service.setValue('vector', SEARCH_AUTO_INDEX_CONFIG_KEY, parsed.data.autoIndexingEnabled)
    }

    let embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
    let reindexRequired = false
    let indexedDimension = await getIndexedDimension(container)

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

      const change = detectConfigChange(
        embeddingConfig,
        {
          ...newConfig,
          updatedAt: new Date().toISOString(),
        },
        indexedDimension
      )

      if (change.requiresReindex) {
        const newDimension = getEffectiveDimension(change.newConfig)
        searchDebug('search.embeddings.update', 'config change detected, recreating table', {
          requiresReindex: change.requiresReindex,
          reason: change.reason,
          oldDimension: indexedDimension,
          newDimension,
        })
        try {
          const drivers = container.resolve<VectorDriver[]>('vectorDrivers')
          const pgvectorDriver = drivers.find((d) => d.id === 'pgvector')
          if (pgvectorDriver?.recreateWithDimension) {
            await pgvectorDriver.recreateWithDimension(newDimension)
            // Query the actual dimension from the database to confirm
            if (pgvectorDriver.getTableDimension) {
              indexedDimension = await pgvectorDriver.getTableDimension()
            } else {
              indexedDimension = newDimension
            }
            searchDebug('search.embeddings.update', 'table recreated successfully', { indexedDimension })
          } else {
            searchDebugWarn('search.embeddings.update', 'pgvector driver does not have recreateWithDimension method')
          }
        } catch (error) {
          searchError('search.embeddings.update', 'failed to recreate table', {
            error: error instanceof Error ? error.message : error,
          })
          return NextResponse.json(
            { error: t('search.api.errors.recreateFailed', 'Failed to recreate vector table with new dimension.') },
            { status: 500 },
          )
        }
      }

      await saveEmbeddingConfig(container, change.newConfig)
      embeddingConfig = change.newConfig

      try {
        const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
        embeddingService.updateConfig(embeddingConfig)
      } catch {
        // Embedding service may not be available in all contexts
      }

      reindexRequired = change.requiresReindex
    }

    const lockedByEnv = envDisablesAutoIndexing()
    let autoIndexingEnabled = !lockedByEnv
    if (!lockedByEnv) {
      try {
        autoIndexingEnabled = await resolveAutoIndexingEnabled(container, { defaultValue: true })
      } catch {
        autoIndexingEnabled = true
      }
    }

    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: lockedByEnv ? false : autoIndexingEnabled,
        autoIndexingLocked: lockedByEnv,
        lockReason: lockedByEnv ? 'env' : null,
        embeddingConfig,
        configuredProviders: getConfiguredProviders(),
        indexedDimension,
        reindexRequired,
      },
    })
  } catch (error) {
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
