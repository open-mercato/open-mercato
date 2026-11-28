import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type RecordScopeFilter = {
  tenantId?: string
  organizationId?: string | { $in: string[] }
}

/**
 * The tenant/organization an update or delete may look a record up in, so a
 * record outside the caller's scope is simply not found (404) instead of being
 * loaded and then refused (403, which confirms the id exists elsewhere).
 *
 * Mirrors what the module's GET routes list (the ledger routes' policy): the
 * tenant always comes from `ctx.auth`; the organization is the selected one.
 * With no organization selected, a superadmin is filtered by tenant only (the
 * list shows every organization of the tenant, so each listed row stays
 * editable), and any other user by the organizations the request scope allows,
 * else their own `auth.orgId`. The input scope is used only when the context
 * carries none (a trusted in-process caller without `ctx.auth`).
 * `ensureTenantScope`/`ensureOrganizationScope` still run on the loaded row.
 */
export function resolveRecordScopeFilter(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null },
): RecordScopeFilter {
  const filter: RecordScopeFilter = {}
  const tenantId = ctx.auth?.tenantId ?? input.tenantId ?? null
  if (tenantId) filter.tenantId = tenantId
  if (ctx.selectedOrganizationId) {
    filter.organizationId = ctx.selectedOrganizationId
    return filter
  }
  if (ctx.auth?.isSuperAdmin === true) return filter
  const allowed = (ctx.organizationIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (allowed.length > 0) {
    filter.organizationId = { $in: allowed }
    return filter
  }
  const organizationId = ctx.auth?.orgId ?? input.organizationId ?? null
  if (organizationId) filter.organizationId = organizationId
  return filter
}
