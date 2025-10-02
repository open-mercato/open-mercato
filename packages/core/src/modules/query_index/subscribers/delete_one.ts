import { markDeleted } from '../lib/indexer'

function toBaseTableFromEntityType(entityType: string): string {
  const [, ent] = (entityType || '').split(':')
  if (!ent) throw new Error(`Invalid entityType: ${entityType}`)
  return ent.endsWith('s') ? ent : `${ent}s`
}

export const metadata = { event: 'query_index.delete_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return
  let organizationId = payload?.organizationId ?? null
  // Fill missing org from base table if needed
  if (organizationId == null) {
    try {
      const knex = (em as any).getConnection().getKnex()
      const table = toBaseTableFromEntityType(entityType)
      const row = await knex(table).select(['organization_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
    } catch {}
  }
  await markDeleted(em, { entityType, recordId, organizationId })
}


