import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { markDeleted } from '../lib/indexer'

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
      const table = resolveEntityTableName(em, entityType)
      const row = await knex(table).select(['organization_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
    } catch {}
  }
  await markDeleted(em, { entityType, recordId, organizationId })
}

