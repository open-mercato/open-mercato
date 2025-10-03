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
    // Build base query depending on mode
    let q = knex({ b: table })
      .select('b.id', 'b.organization_id', 'b.tenant_id')
      .whereNull('b.deleted_at')

    // Scope base rows
    if (orgId !== undefined) {
      if (orgId === null) q = q.whereNull('b.organization_id')
      else q = q.andWhere((bld: any) => bld.where({ 'b.organization_id': orgId }).orWhereNull('b.organization_id'))
    }
    if (tenantId !== undefined) {
      if (tenantId === null) q = q.whereNull('b.tenant_id')
      else q = q.andWhere((bld: any) => bld.where({ 'b.tenant_id': tenantId }).orWhereNull('b.tenant_id'))
    }

    if (!forceFull) {
      // Resume: only rows missing in index for the target scope
      const orgExpr = (orgId !== undefined) ? knex.raw('?', [orgId]) : knex.raw('b.organization_id')
      const tenantExpr = (tenantId !== undefined) ? knex.raw('?', [tenantId]) : knex.raw('b.tenant_id')
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
      const scopeOrg = orgId !== undefined ? orgId : (r.organization_id ?? null)
      const scopeTenant = tenantId !== undefined ? tenantId : (r.tenant_id ?? null)
      await eventBus.emitEvent('query_index.upsert_one', { entityType, recordId: String(r.id), organizationId: scopeOrg, tenantId: scopeTenant })
    }
  } finally {
    // Always remove the lock record for this scope so a restart is possible
    try { await lockScope().del() } catch {}
  }
}

