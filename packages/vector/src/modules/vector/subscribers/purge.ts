import { recordIndexerError } from '@/lib/indexers/error-log'
import type { VectorIndexService } from '@open-mercato/vector'

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

  try {
    await service.purgeIndex({
      entityId: entityType,
      tenantId,
      organizationId,
    })
  } catch (error) {
    console.warn('[vector] Failed to purge vector index scope', {
      entityType,
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : error,
    })
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
