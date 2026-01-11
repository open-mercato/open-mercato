import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { env } from 'process'

function logScopeViolation(
  ctx: CommandRuntimeContext,
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
    if (env.NODE_ENV !== 'test') {
      console.warn('[scope] Forbidden organization scope mismatch detected', {
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
    }
  } catch {
    // best-effort logging
  }
}

export function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (currentOrg && currentOrg !== organizationId) {
    logScopeViolation(ctx, organizationId, currentOrg)
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}
