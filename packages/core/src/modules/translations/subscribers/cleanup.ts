import { type Kysely, sql } from 'kysely'

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
    const em = ctx.resolve<{ getKysely<T = any>(): Kysely<T> }>('em')
    const db = em.getKysely<any>() as any
    await db
      .deleteFrom('entity_translations')
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', recordId)
      .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
      .execute()
  } catch (err) {
    console.warn('[translations/cleanup] Failed to delete translations:', err instanceof Error ? err.message : 'unknown')
  }
}
