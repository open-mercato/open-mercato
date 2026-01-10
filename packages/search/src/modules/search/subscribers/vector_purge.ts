import { recordIndexerError } from '@/lib/indexers/error-log'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type { EmbeddingService } from '../../../vector'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import { resolveEmbeddingConfig } from '../lib/embedding-config'
import type { EntityId } from '@open-mercato/shared/modules/entities'

export const metadata = { event: 'query_index.vectorize_purge', persistent: false }

type Payload = {
  entityType?: string
  tenantId?: string | null
  organizationId?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const entityType = String(payload?.entityType ?? '')
  if (!entityType) return
  const tenantIdRaw = payload?.tenantId
  if (tenantIdRaw == null || tenantIdRaw === '') {
    console.warn('[search.vector] Skipping vector purge for reindex without tenant scope', { entityType })
    return
  }
  const tenantId = String(tenantIdRaw)
  const organizationId = payload?.organizationId == null ? null : String(payload.organizationId)

  let searchIndexer: SearchIndexer
  try {
    searchIndexer = ctx.resolve<SearchIndexer>('searchIndexer')
  } catch {
    return
  }

  // Load saved embedding config for consistency (dimension info may be needed for table recreation)
  try {
    const embeddingConfig = await resolveEmbeddingConfig(ctx, { defaultValue: null })
    if (embeddingConfig) {
      const embeddingService = ctx.resolve<EmbeddingService>('vectorEmbeddingService')
      embeddingService.updateConfig(embeddingConfig)
    }
  } catch {
    // Purge operations don't require embedding, ignore config errors
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any = null
  try {
    em = ctx.resolve('em')
  } catch {
    em = null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eventBus: { emitEvent(event: string, payload: any, options?: any): Promise<void> } | null = null
  try {
    eventBus = ctx.resolve('eventBus')
  } catch {
    eventBus = null
  }
  const scopes = new Set<string>()
  const registerScope = (org: string | null) => {
    const key = org ?? '__null__'
    if (!scopes.has(key)) scopes.add(key)
  }
  registerScope(null)
  if (organizationId != null) registerScope(organizationId)

  try {
    await searchIndexer.purgeEntity({
      entityId: entityType as EntityId,
      tenantId,
    })
    if (em) {
      try {
        for (const scope of scopes) {
          const orgValue = scope === '__null__' ? null : scope
          await writeCoverageCounts(
            em,
            {
              entityType,
              tenantId,
              organizationId: orgValue,
              withDeleted: false,
            },
            { vectorCount: 0 },
          )
        }
      } catch (coverageError) {
        console.warn('[search.vector] Failed to reset vector coverage after purge', coverageError)
      }
    }
    if (eventBus) {
      await Promise.all(
        Array.from(scopes).map((scope) => {
          const orgValue = scope === '__null__' ? null : scope
          return eventBus!
            .emitEvent(
              'query_index.coverage.refresh',
              {
                entityType,
                tenantId,
                organizationId: orgValue,
                delayMs: 0,
              },
            )
            .catch(() => undefined)
        }),
      )
    }
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'event:query_index.vectorize_purge',
        message: `Vector purge completed for ${entityType}`,
        entityType,
        tenantId,
        organizationId,
        details: payload,
      },
    ).catch(() => undefined)
  } catch (error) {
    console.warn('[search.vector] Failed to purge vector index scope', {
      entityType,
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : error,
    })
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'event:query_index.vectorize_purge',
        level: 'warn',
        message: `Vector purge failed for ${entityType}`,
        entityType,
        tenantId,
        organizationId,
        details: { error: error instanceof Error ? error.message : String(error), payload },
      },
    ).catch(() => undefined)
    await recordIndexerError(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'event:query_index.vectorize_purge',
        error,
        entityType,
        tenantId,
        organizationId,
        payload,
      },
    )
  }
}
