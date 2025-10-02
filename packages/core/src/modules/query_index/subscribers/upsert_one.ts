import { upsertIndexRow } from '../lib/indexer'

function toBaseTableFromEntityType(entityType: string): string {
  const [, ent] = (entityType || '').split(':')
  if (!ent) throw new Error(`Invalid entityType: ${entityType}`)
  return ent.endsWith('s') ? ent : `${ent}s`
}

export const metadata = { event: 'query_index.upsert_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return
  let organizationId = payload?.organizationId ?? null
  let tenantId = payload?.tenantId ?? null
  // Fill missing scope from base table if needed
  if (organizationId == null || tenantId == null) {
    try {
      const knex = (em as any).getConnection().getKnex()
      const table = toBaseTableFromEntityType(entityType)
      const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
      if (tenantId == null) tenantId = row?.tenant_id ?? tenantId
    } catch {}
  }
  await upsertIndexRow(em, { entityType, recordId, organizationId, tenantId })
  // Kick off secondary pass (vectorize) asynchronously
  try {
    const bus = ctx.resolve<any>('eventBus')
    await bus.emitEvent('query_index.vectorize_one', { entityType, recordId, organizationId, tenantId })
  } catch {}
}


