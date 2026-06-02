import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
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

function logTenantScopeViolation(
  ctx: CommandRuntimeContext,
  expectedTenantId: string,
  actualTenantId: string | null
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
      console.warn('[scope] Forbidden tenant scope mismatch detected', {
        expectedTenantId,
        actualTenantId,
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
  const isSuperAdmin = ctx.auth?.isSuperAdmin === true
  const scope = ctx.organizationScope

  // Pattern C: when no organization scope was resolved (system/worker/non-user
  // command contexts that build ctx with `organizationScope: null`), preserve
  // the legacy currentOrg fallback. This branch is load-bearing — switching it
  // to deny would break payment, scheduled-command, and other scope-less flows.
  if (!scope) {
    if (isSuperAdmin) return
    const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (currentOrg && currentOrg !== organizationId) {
      logScopeViolation(ctx, organizationId, currentOrg)
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    return
  }

  if (
    isOrganizationAccessAllowed({
      isSuperAdmin,
      allowedOrganizationIds: scope.allowedIds,
      targetOrganizationId: organizationId,
    })
  ) {
    return
  }

  const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  logScopeViolation(ctx, organizationId, currentOrg)
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    logTenantScopeViolation(ctx, tenantId, currentTenant)
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureSameScope(
  entity: Pick<{ organizationId: string; tenantId: string }, 'organizationId' | 'tenantId'>,
  organizationId: string,
  tenantId: string
): void {
  if (entity.organizationId !== organizationId || entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}
