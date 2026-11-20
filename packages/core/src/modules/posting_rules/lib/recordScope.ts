import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type RecordScopeFilter = { tenantId?: string; organizationId?: string }

/**
 * The tenant/organization an update or delete may look a record up in, so a
 * record outside the caller's scope is simply not found (404) instead of being
 * loaded and then refused (403, which confirms the id exists elsewhere). The
 * tenant comes from `ctx.auth`, the organization from the selected
 * organization (else `ctx.auth.orgId`); the input scope is used only when the
 * context carries none (a trusted in-process caller without `ctx.auth`). A
 * superadmin with no organization selected is filtered by tenant only;
 * `ensureTenantScope`/`ensureOrganizationScope` still run on the loaded row.
 */
export function resolveRecordScopeFilter(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null },
): RecordScopeFilter {
  const tenantId = ctx.auth?.tenantId ?? input.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? input.organizationId ?? null
  const filter: RecordScopeFilter = {}
  if (tenantId) filter.tenantId = tenantId
  if (organizationId) filter.organizationId = organizationId
  return filter
}
