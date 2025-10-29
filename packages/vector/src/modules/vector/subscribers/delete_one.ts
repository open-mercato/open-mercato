import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { VectorIndexService } from '@open-mercato/vector'

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

  if (organizationId == null || tenantId == null) {
    try {
      const em = ctx.resolve<any>('em')
      const knex = (em as any).getConnection().getKnex()
      const table = resolveEntityTableName(em, entityType)
      const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
      if (tenantId == null) tenantId = row?.tenant_id ?? tenantId
    } catch {}
  }
  if (!tenantId) return

  let service: VectorIndexService
  try {
    service = ctx.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return
  }

  try {
    await service.deleteRecord({
      entityId: entityType,
      recordId,
      tenantId: String(tenantId),
    })
  } catch (error) {
    console.warn('[vector] Failed to delete vector index entry', error)
  }
}
