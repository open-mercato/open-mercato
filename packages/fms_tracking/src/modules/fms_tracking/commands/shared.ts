import { CommandRuntimeContext } from "@/lib/commands"
import { CrudHttpError } from "@/lib/crud/errors"

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    logScopeViolation(ctx, 'tenant', tenantId, currentTenant)
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (currentOrg && currentOrg !== organizationId) {
    logScopeViolation(ctx, 'organization', organizationId, currentOrg)
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function logScopeViolation(
  ctx: CommandRuntimeContext,
  kind: 'tenant' | 'organization',
  expected: string,
  actual: string | null
): void {
  try {
    const requestInfo =
      ctx.request && typeof ctx.request === 'object'
        ? {
            method: (ctx.request as Request).method ?? undefined,
            url: (ctx.request as Request).url ?? undefined,
          }
        : null
    const scope = ctx.organizationScope
      ? {
          selectedId: ctx.organizationScope.selectedId ?? null,
          tenantId: ctx.organizationScope.tenantId ?? null,
          allowedIdsCount: Array.isArray(ctx.organizationScope.allowedIds)
            ? ctx.organizationScope.allowedIds.length
            : null,
          filterIdsCount: Array.isArray(ctx.organizationScope.filterIds)
            ? ctx.organizationScope.filterIds.length
            : null,
        }
      : null
    console.warn('[catalog.scope] Forbidden scope mismatch detected', {
      scopeKind: kind,
      expectedId: expected,
      actualId: actual,
      userId: ctx.auth?.sub ?? null,
      actorTenantId: ctx.auth?.tenantId ?? null,
      actorOrganizationId: ctx.auth?.orgId ?? null,
      selectedOrganizationId: ctx.selectedOrganizationId ?? null,
      organizationIdsCount: Array.isArray(ctx.organizationIds) ? ctx.organizationIds.length : null,
      scope,
      request: requestInfo,
    })
  } catch {
    // best-effort logging; ignore secondary failures
  }
}