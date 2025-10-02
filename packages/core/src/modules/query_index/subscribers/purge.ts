export const metadata = { event: 'query_index.purge', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()

  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  // Mark job started
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
    try {
      await knex('entity_index_jobs')
        .where({ entity_type: entityType })
        .modify((qb: any) => { if (orgId !== undefined) qb.andWhere({ organization_id: orgId }) })
        .modify((qb: any) => { if (tenantId !== undefined) qb.andWhere({ tenant_id: tenantId }) })
        .update({ finished_at: knex.fn.now() })
    } catch {}
  }
}


