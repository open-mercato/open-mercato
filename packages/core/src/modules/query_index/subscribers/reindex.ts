export const metadata = { event: 'query_index.reindex', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()
  const eventBus = ctx.resolve<any>('eventBus')

  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  const table = (() => {
    const [, ent] = entityType.split(':')
    return ent.endsWith('s') ? ent : `${ent}s`
  })()

  // Mark job started
  try {
    await knex('entity_index_jobs').insert({
      entity_type: entityType,
      organization_id: orgId,
      tenant_id: tenantId,
      status: 'reindexing',
      started_at: knex.fn.now(),
    })
  } catch {}

  try {
    const where: any = { deleted_at: null }
    if (orgId !== undefined) where.organization_id = orgId
    if (tenantId !== undefined) where.tenant_id = tenantId
    const rows = await knex(table).where(where).select('id', 'organization_id', 'tenant_id')
    for (const r of rows) {
      const scopeOrg = orgId !== undefined ? orgId : (r.organization_id ?? null)
      const scopeTenant = tenantId !== undefined ? tenantId : (r.tenant_id ?? null)
      await eventBus.emitEvent('query_index.upsert_one', { entityType, recordId: String(r.id), organizationId: scopeOrg, tenantId: scopeTenant })
    }
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


