import { recordIndexerError } from '@/lib/indexers/error-log'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { applyCoverageAdjustments, createCoverageAdjustments } from '@open-mercato/core/modules/query_index/lib/coverage'
import type { VectorIndexOperationResult, VectorIndexService, EmbeddingService } from '@open-mercato/vector'
import { resolveVectorAutoIndexingEnabled } from '../lib/auto-indexing'
import { resolveEmbeddingConfig } from '../lib/embedding-config'
import { logVectorOperation } from '../../../lib/vector-logs'

export const metadata = { event: 'query_index.delete_one', persistent: false }

type Payload = {
  entityType?: string
  recordId?: string
  organizationId?: string | null
  tenantId?: string | null
}

type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const entityType = String(payload?.entityType ?? '')
  const recordId = String(payload?.recordId ?? '')
  if (!entityType || !recordId) return
  let organizationId = payload?.organizationId ?? null
  let tenantId = payload?.tenantId ?? null

  let em: any | null = null
  try {
    em = ctx.resolve<any>('em')
  } catch {
    em = null
  }

  if ((organizationId == null || tenantId == null) && em) {
    try {
      const knex = (em as any).getConnection().getKnex()
      const table = resolveEntityTableName(em, entityType)
      const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
      if (tenantId == null) tenantId = row?.tenant_id ?? tenantId
    } catch {}
  }
  if (!tenantId) return

  const autoIndexingEnabled = await resolveVectorAutoIndexingEnabled(ctx, { defaultValue: true })
  if (!autoIndexingEnabled) return

  let service: VectorIndexService
  try {
    service = ctx.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return
  }

  // Load saved embedding config for consistency (dimension info may be needed)
  try {
    const embeddingConfig = await resolveEmbeddingConfig(ctx, { defaultValue: null })
    if (embeddingConfig) {
      const embeddingService = ctx.resolve<EmbeddingService>('vectorEmbeddingService')
      embeddingService.updateConfig(embeddingConfig)
    }
  } catch {
    // Delete operations don't require embedding, ignore config errors
  }

  try {
    const result = await service.deleteRecord({
      entityId: entityType,
      recordId,
      tenantId: String(tenantId),
      organizationId: organizationId ?? null,
    })
    const delta = computeVectorDelta(result)
    if (delta !== 0 && em) {
      try {
        const adjustments = createCoverageAdjustments({
          entityType,
          tenantId: String(tenantId),
          organizationId: organizationId ?? null,
          baseDelta: 0,
          indexDelta: 0,
          vectorDelta: delta,
        })
        if (adjustments.length) {
          await applyCoverageAdjustments(em, adjustments)
        }
      } catch (coverageError) {
        console.warn('[vector] Failed to adjust vector coverage', coverageError)
      }
    }
    await logVectorOperation({
      em,
      handler: 'event:query_index.delete_one',
      entityType,
      recordId,
      result,
    })
  } catch (error) {
    console.warn('[vector] Failed to delete vector index entry', error)
    await recordIndexerError(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'event:query_index.delete_one',
        error,
        entityType,
        recordId,
        tenantId: tenantId ? String(tenantId) : null,
        organizationId: organizationId ?? null,
        payload,
      },
    )
  }
}

function computeVectorDelta(result: VectorIndexOperationResult): number {
  if (!result) return 0
  if (result.action === 'deleted') return result.existed ? -1 : 0
  if (result.action === 'indexed') return result.created ? 1 : 0
  return 0
}
