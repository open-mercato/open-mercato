import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { env } from 'process'

function buildScopeLogContext(ctx: CommandRuntimeContext) {
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
  return {
    userId: ctx.auth?.sub ?? null,
    actorTenantId: ctx.auth?.tenantId ?? null,
    actorOrganizationId: ctx.auth?.orgId ?? null,
    selectedOrganizationId: ctx.selectedOrganizationId ?? null,
    organizationIdsCount: Array.isArray(ctx.organizationIds) ? ctx.organizationIds.length : null,
    scope,
    request: requestInfo,
  }
}

function isStrictOrganizationScopeEnforced(): boolean {
  return parseBooleanWithDefault(env.OM_ENFORCE_ORG_SCOPE_STRICT, false)
}

function logScopeViolation(
  ctx: CommandRuntimeContext,
  expected: string,
  actual: string | null
): void {
  try {
    if (env.NODE_ENV !== 'test') {
      console.warn('[scope] Forbidden organization scope mismatch detected', {
        expectedId: expected,
        actualId: actual,
        ...buildScopeLogContext(ctx),
      })
    }
  } catch {
    // best-effort logging
  }
}

function logUnscopedOrganizationAccess(ctx: CommandRuntimeContext, organizationId: string): void {
  try {
    if (env.NODE_ENV !== 'test') {
      console.warn('[scope] Unscoped organization command executed without organization context', {
        targetOrganizationId: organizationId,
        strictEnforcement: isStrictOrganizationScopeEnforced(),
        ...buildScopeLogContext(ctx),
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
    if (env.NODE_ENV !== 'test') {
      console.warn('[scope] Forbidden tenant scope mismatch detected', {
        expectedTenantId,
        actualTenantId,
        ...buildScopeLogContext(ctx),
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
    if (currentOrg) {
      if (currentOrg !== organizationId) {
        logScopeViolation(ctx, organizationId, currentOrg)
        throw new CrudHttpError(403, { error: 'Forbidden' })
      }
      return
    }
    // No current org could be resolved either. This branch previously returned
    // with no validation and no signal — a fail-open-by-omission shape (#2441):
    // a new command path reaching here with `organizationScope: null` would act
    // on an arbitrary target org silently. Preserve the legacy allow behavior by
    // default (the path is load-bearing) but make the unscoped access observable,
    // and let operators harden it into a deny via OM_ENFORCE_ORG_SCOPE_STRICT.
    if (organizationId) {
      logUnscopedOrganizationAccess(ctx, organizationId)
      if (isStrictOrganizationScopeEnforced()) {
        throw new CrudHttpError(403, { error: 'Forbidden' })
      }
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
