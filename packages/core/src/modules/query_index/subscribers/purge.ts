export const metadata = { event: 'query_index.purge', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()

  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  const lockScope = () =>
    knex('entity_index_jobs')
      .where('entity_type', entityType)
      .andWhereRaw('organization_id is not distinct from ?', [orgId])
      .andWhereRaw('tenant_id is not distinct from ?', [tenantId])

  // Ensure any previous lock is removed before purging
  try { await lockScope().del() } catch {}

  // Mark job started (we will remove it at the end)
  try {
    await knex('entity_index_jobs').insert({
      entity_type: entityType,
      organization_id: orgId,
      tenant_id: tenantId,
      status: 'purging',
      started_at: knex.fn.now(),
    })
  } catch {}

  try {
    const q = knex('entity_indexes').where({ entity_type: entityType })
    if (orgId !== undefined) q.andWhere((b: any) => b.where({ organization_id: orgId }).orWhereNull('organization_id'))
    if (tenantId !== undefined) q.andWhere((b: any) => b.where({ tenant_id: tenantId }).orWhereNull('tenant_id'))
    await q.update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
  } finally {
    // Always remove the lock record to allow restart
    try { await lockScope().del() } catch {}
  }
}

