export const metadata = { event: 'query_index.reindex', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()
  const eventBus = ctx.resolve<any>('eventBus')

  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  // Keep undefined to mean "no filter"; null to mean "global-only"
  const orgId: string | null | undefined = payload?.organizationId
  const tenantId: string | null | undefined = payload?.tenantId
  const forceFull: boolean = Boolean(payload?.force)

  const table = (() => {
    const [, ent] = entityType.split(':')
    return ent.endsWith('s') ? ent : `${ent}s`
  })()

  const lockScope = () =>
    knex('entity_index_jobs')
      .where('entity_type', entityType)
      .andWhereRaw('organization_id is not distinct from ?', [orgId ?? null])
      .andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])

  // If forced, clear any previous lock for this scope
  if (forceFull) {
    try { await lockScope().del() } catch {}
  }

  // Check existing lock
  const existing = await lockScope().first()

  // Create lock if not resuming
  if (!existing) {
    try {
      await knex('entity_index_jobs').insert({
        entity_type: entityType,
        organization_id: orgId ?? null,
        tenant_id: tenantId ?? null,
        status: 'reindexing',
        started_at: knex.fn.now(),
      })
    } catch {}
  }

  try {
    // Detect optional multi-tenant/deleted columns for the base table
    const hasOrgCol = await knex.schema.hasColumn(table, 'organization_id')
    const hasTenantCol = await knex.schema.hasColumn(table, 'tenant_id')
    const hasDeletedCol = await knex.schema.hasColumn(table, 'deleted_at')

    // Build base query depending on mode; select only columns that exist
    const baseSelect: any[] = ['b.id']
    if (hasOrgCol) baseSelect.push('b.organization_id')
    if (hasTenantCol) baseSelect.push('b.tenant_id')
    let q = knex({ b: table }).select(baseSelect)
    if (hasDeletedCol) q = q.whereNull('b.deleted_at')

    // Scope base rows
    if (orgId !== undefined && hasOrgCol) {
      if (orgId === null) q = q.whereNull('b.organization_id')
      else q = q.andWhere((bld: any) => bld.where({ 'b.organization_id': orgId }).orWhereNull('b.organization_id'))
    }
    if (tenantId !== undefined && hasTenantCol) {
      if (tenantId === null) q = q.whereNull('b.tenant_id')
      else q = q.andWhere((bld: any) => bld.where({ 'b.tenant_id': tenantId }).orWhereNull('b.tenant_id'))
    }

    if (!forceFull) {
      // Resume: only rows missing in index for the target scope
      const orgExpr = (orgId !== undefined)
        ? knex.raw('?', [orgId])
        : (hasOrgCol ? knex.raw('b.organization_id') : knex.raw('null'))
      const tenantExpr = (tenantId !== undefined)
        ? knex.raw('?', [tenantId])
        : (hasTenantCol ? knex.raw('b.tenant_id') : knex.raw('null'))
      const onParts: string[] = []
      onParts.push(knex.raw('ei.entity_type = ?', [entityType]).toString())
      onParts.push('ei.entity_id = (b.id::text)')
      onParts.push(`(ei.organization_id is not distinct from ${orgExpr.toString()})`)
      onParts.push(`(ei.tenant_id is not distinct from ${tenantExpr.toString()})`)
      onParts.push('ei.deleted_at is null')
      q = q.leftJoin({ ei: 'entity_indexes' }, knex.raw(onParts.join(' AND ')))
        .whereNull('ei.id')
    }

    const rows = await q
    for (const r of rows) {
      const scopeOrg = orgId !== undefined ? orgId : (hasOrgCol ? (r as any).organization_id ?? null : null)
      const scopeTenant = tenantId !== undefined ? tenantId : (hasTenantCol ? (r as any).tenant_id ?? null : null)
      await eventBus.emitEvent('query_index.upsert_one', { entityType, recordId: String(r.id), organizationId: scopeOrg, tenantId: scopeTenant })
    }
  } finally {
    // Always remove the lock record for this scope so a restart is possible
    try { await lockScope().del() } catch {}
  }
}
