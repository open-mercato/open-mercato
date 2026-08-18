export type ScheduleScopeActor = {
  tenantId?: string | null
  orgId?: string | null
  isSuperAdmin?: boolean
}

export type ScheduleScopeSubject = {
  scopeType?: string | null
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
 * System scope is classified exactly as `ensureCanManageSystemScopedJob` classifies it, so
 * update, delete, trigger and executions cannot disagree about what a system-scoped row is.
 *
 * `not_found` vs `forbidden` is deliberate. Another tenant's or another organization's
 * schedule answers `not_found`, because a 403 would confirm that the id exists. Only a
 * system-scoped schedule answers `forbidden` — its existence is a property of the
 * deployment, not of a tenant.
 *
 * An unresolved actor tenant fails closed for everyone, super admins included, matching
 * `buildSchedulerJobsFilters`, which returns an unmatchable filter when the tenant is
 * falsy. Such an actor cannot see a tenant-bound schedule in the list either.
 *
 * Super-admin status reads the immutable `isSuperAdmin` flag derived from RoleAcl/UserAcl at
 * session resolution. Never compare role names, which are tenant-mutable and spoofable.
 *
 * Organization isolation compares the actor's single `orgId`, which is what both routes did
 * before and is narrower than the list endpoint's resolved organization scope
 * (`filterIds`: the selected organization plus its descendants). The two therefore still
 * disagree for an actor whose scope spans several organizations. That divergence predates
 * this helper and is tracked separately; it is preserved here rather than widened, because
 * widening it silently would grant access the previous lookup did not.
 */
export function resolveScheduleAccess(
  schedule: ScheduleScopeSubject,
  actor: ScheduleScopeActor | null | undefined,
): ScheduleAccessDecision {
  const isSuperAdmin = actor?.isSuperAdmin === true
  const scheduleTenantId = schedule.tenantId ?? null

  if (schedule.scopeType === 'system' || scheduleTenantId === null) {
    return isSuperAdmin ? 'allowed' : 'forbidden'
  }

  const actorTenantId = actor?.tenantId ?? null
  if (actorTenantId === null) return 'not_found'
  if (scheduleTenantId !== actorTenantId) return 'not_found'

  const scheduleOrganizationId = schedule.organizationId ?? null
  const actorOrganizationId = actor?.orgId ?? null
  if (scheduleOrganizationId !== null && actorOrganizationId !== null && scheduleOrganizationId !== actorOrganizationId) {
    return 'not_found'
  }

  return 'allowed'
}
