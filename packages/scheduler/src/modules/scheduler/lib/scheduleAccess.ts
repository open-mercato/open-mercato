export type ScheduleScopeActor = {
  tenantId?: string | null
  orgId?: string | null
  isSuperAdmin?: boolean
}

export type ScheduleScopeSubject = {
  tenantId?: string | null
  organizationId?: string | null
}

export type ScheduleAccessDecision = 'allowed' | 'not_found' | 'forbidden'

/**
 * Decides whether an actor may act on a single schedule that was loaded by id alone.
 *
 * Isolation belongs here, on the loaded row, and never in the `where` clause: a
 * system-scoped schedule has `tenantId === null` and `organizationId === null`, so folding
 * the actor's tenant/org into the lookup makes that row unmatchable and turns every
 * system-scope check below into dead code. `commands/jobs.ts` (update/delete) and
 * `api/jobs/buildFilters.ts` (list) already model visibility this way.
 *
 * `not_found` vs `forbidden` is deliberate. Another tenant's or another organization's
 * schedule answers `not_found`, because a 403 would confirm that the id exists. Only a
 * system-scoped schedule answers `forbidden` — its existence is a property of the
 * deployment, not of a tenant.
 *
 * Super-admin status reads the immutable `isSuperAdmin` flag derived from RoleAcl/UserAcl at
 * session resolution. Never compare role names, which are tenant-mutable and spoofable.
 */
export function resolveScheduleAccess(
  schedule: ScheduleScopeSubject,
  actor: ScheduleScopeActor | null | undefined,
): ScheduleAccessDecision {
  const isSuperAdmin = actor?.isSuperAdmin === true
  const scheduleTenantId = schedule.tenantId ?? null
  const scheduleOrganizationId = schedule.organizationId ?? null

  if (scheduleTenantId === null && scheduleOrganizationId === null) {
    return isSuperAdmin ? 'allowed' : 'forbidden'
  }

  const actorTenantId = actor?.tenantId ?? null
  if (actorTenantId === null) {
    // Fail closed on an unresolved tenant, mirroring buildFilters. A super admin keeps
    // full reach; anyone else without a tenant must not read across tenants.
    return isSuperAdmin ? 'allowed' : 'not_found'
  }
  if (scheduleTenantId !== actorTenantId) return 'not_found'

  const actorOrganizationId = actor?.orgId ?? null
  if (scheduleOrganizationId !== null && actorOrganizationId !== null && scheduleOrganizationId !== actorOrganizationId) {
    return 'not_found'
  }

  return 'allowed'
}
