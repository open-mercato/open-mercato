export type ScheduleScopeActor = {
  tenantId?: string | null
  orgId?: string | null
  isSuperAdmin?: boolean
}

export type ScheduleScopeType = 'system' | 'organization' | 'tenant'

/**
 * The scope columns of a loaded `ScheduledJob` row. Every field is optional because the
 * entity declares them that way (`tenantId?: string | null`), so a required shape here
 * could not accept the row the routes actually load.
 *
 * `undefined` is therefore normalized to `null` on read. That is fail-closed where it
 * matters: an absent `tenantId` classifies the row as system-scoped, which restricts it to
 * super admins rather than widening it. An absent `organizationId` reads as "not bound to an
 * organization", the same as an explicit null, which is what the list endpoint's tenant
 * branch already treats as tenant-wide.
 */
export type ScheduleScopeSubject = {
  scopeType?: ScheduleScopeType | null
  tenantId?: string | null
  organizationId?: string | null
}

export type ScheduleAccessDecision = 'allowed' | 'not_found' | 'forbidden'

/**
 * Decides whether an actor may act on a single schedule that was loaded by id alone.
 *
 * Isolation belongs here, on the loaded row, and never in the `where` clause: a
 * system-scoped schedule carries a null `tenantId`, so folding the actor's tenant into the
 * lookup makes that row unmatchable and turns every system-scope check below into dead code.
 * `commands/jobs.ts` (update/delete) and `api/jobs/buildFilters.ts` (list) already model
 * visibility this way.
 *
 * System scope is classified exactly as `ensureCanManageSystemScopedJob` classifies it —
 * `scopeType === 'system' || tenantId == null` — so update, delete, trigger and executions
 * cannot disagree about what a system-scoped row is. `organizationId` deliberately plays no
 * part in that test: a row with a null tenant is system-scoped whether or not an
 * organization is set, which is how the create validator's scope refinement and the two
 * command guards already read it.
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
 * Organization isolation compares the actor's single `orgId`, where the list endpoint uses
 * the resolved organization scope (`filterIds`: the selected organization plus its
 * descendants). The two diverge in **both** directions, and the second is the permissive one:
 *
 * - Narrower: an actor whose scope spans several organizations sees those rows in the list
 *   but is answered `not_found` here.
 * - Wider: an actor carrying no `orgId` at all reaches any org-bound row inside its tenant,
 *   because the organization comparison below short-circuits — while the list hides those
 *   rows entirely, emitting its organization branch only when at least one id is known.
 *
 * Both directions are inherited from the lookup this helper replaces, which compared the same
 * single id and omitted the clause entirely when it was absent. They are preserved rather
 * than corrected here, because widening or narrowing silently would change access the
 * previous lookup granted; reconciling the two paths is tracked separately.
 */
export function resolveScheduleAccess(
  schedule: ScheduleScopeSubject,
  actor: ScheduleScopeActor | null | undefined,
): ScheduleAccessDecision {
  const isSuperAdmin = actor?.isSuperAdmin === true
  const scheduleTenantId = schedule.tenantId ?? null

  const actorTenantId = actor?.tenantId ?? null

  if (schedule.scopeType === 'system' || scheduleTenantId === null) {
    if (isSuperAdmin) return 'allowed'
    // A row mislabelled `system` while still bound to a tenant must not confirm its
    // existence across a tenant boundary — answering 403 there would tell an actor in one
    // tenant that the id exists in another, which is the disclosure the `not_found`
    // decisions below exist to prevent. Only a genuinely tenant-less row answers 403.
    if (scheduleTenantId !== null && scheduleTenantId !== actorTenantId) return 'not_found'
    return 'forbidden'
  }

  if (actorTenantId === null) return 'not_found'
  if (scheduleTenantId !== actorTenantId) return 'not_found'

  // Unlike the list endpoint's equivalent branch, which pins `scope_type = 'tenant'`
  // (buildFilters.ts), an org-null row is reachable here whatever its `scopeType`. Same
  // scope-inconsistent-row class as above and equally not producible by the create path;
  // left loose deliberately rather than diverging from the pre-existing lookup.
  const scheduleOrganizationId = schedule.organizationId ?? null
  const actorOrganizationId = actor?.orgId ?? null
  if (scheduleOrganizationId !== null && actorOrganizationId !== null && scheduleOrganizationId !== actorOrganizationId) {
    return 'not_found'
  }

  return 'allowed'
}
