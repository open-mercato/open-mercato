import type { Knex } from 'knex'

export const metadata = { event: 'query_index.delete_one', persistent: false }

export default async function handle(
  payload: { entityType?: string; recordId?: string; organizationId?: string | null; tenantId?: string | null },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return

  const organizationId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  try {
    const em = ctx.resolve<{ getConnection(): { getKnex(): Knex } }>('em')
    const knex = em.getConnection().getKnex()
    await knex('entity_translations')
      .where({
        entity_type: entityType,
        entity_id: recordId,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [organizationId])
      .del()
  } catch (err) {
    console.warn('[translations/cleanup] Failed to delete translations:', err instanceof Error ? err.message : 'unknown')
  }
}
