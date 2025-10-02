import { upsertIndexRow } from '../lib/indexer'

export const metadata = { event: 'query_index.upsert_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  const organizationId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null
  if (!entityType || !recordId) return
  await upsertIndexRow(em, { entityType, recordId, organizationId, tenantId })
  // Kick off secondary pass (vectorize) asynchronously
  try {
    const bus = ctx.resolve<any>('eventBus')
    await bus.emitEvent('query_index.vectorize_one', { entityType, recordId, organizationId, tenantId })
  } catch {}
}


