import { recordIndexerError } from '@/lib/indexers/error-log'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import type { VectorIndexService } from '@open-mercato/vector'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'

export const metadata = { event: 'query_index.vectorize_purge', persistent: false }

type Payload = {
  entityType?: string
  tenantId?: string | null
  organizationId?: string | null
}

type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const entityType = String(payload?.entityType ?? '')
  if (!entityType) return
  const tenantIdRaw = payload?.tenantId
  if (tenantIdRaw == null || tenantIdRaw === '') {
    console.warn('[vector] Skipping vector purge for reindex without tenant scope', { entityType })
    return
  }
  const tenantId = String(tenantIdRaw)
  const organizationId = payload?.organizationId == null ? null : String(payload.organizationId)

  let service: VectorIndexService
  try {
    service = ctx.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return
  }

  let em: any | null = null
  try {
    em = ctx.resolve<any>('em')
  } catch {
    em = null
  }
  let eventBus: { emitEvent(event: string, payload: any, options?: any): Promise<void> } | null = null
  try {
    eventBus = ctx.resolve<any>('eventBus')
  } catch {
    eventBus = null
  }

  try {
    await service.purgeIndex({
      entityId: entityType,
      tenantId,
      organizationId,
    })
    if (em) {
      try {
        const scopes = new Set<string>()
        const registerScope = (org: string | null) => {
          const key = org ?? '__null__'
          if (!scopes.has(key)) scopes.add(key)
        }
        registerScope(null)
        if (organizationId != null) registerScope(organizationId)
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
        console.warn('[vector] Failed to reset vector coverage after purge', coverageError)
      }
    }
    if (eventBus) {
      await eventBus.emitEvent(
        'query_index.coverage.refresh',
        {
          entityType,
          tenantId,
          organizationId: null,
          delayMs: 0,
        },
      ).catch(() => undefined)
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
    console.warn('[vector] Failed to purge vector index scope', {
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
