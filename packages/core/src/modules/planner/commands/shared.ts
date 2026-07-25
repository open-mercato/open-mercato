import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { FilterQuery } from '@mikro-orm/postgresql'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

export type PlannerCommandScope = {
  tenantId: string | null
  organizationId: string | null
  requireTenant: boolean
  requireOrganization: boolean
}

export function commandActorScope(ctx: CommandRuntimeContext): PlannerCommandScope {
  const isPrivilegedActor = ctx.auth?.isSuperAdmin === true || ctx.systemActor === true
  const tenantId = isPrivilegedActor ? null : (ctx.auth?.tenantId ?? ctx.organizationScope?.tenantId ?? null)
  const organizationId = isPrivilegedActor ? null : (ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null)
  const organizationUnrestricted =
    isPrivilegedActor || (organizationId === null && tenantId !== null && ctx.organizationScope?.allowedIds === null)
  return {
    tenantId,
    organizationId: organizationUnrestricted ? null : organizationId,
    requireTenant: !isPrivilegedActor,
    requireOrganization: !organizationUnrestricted,
  }
}

export function explicitPlannerCommandScope(
  tenantId: string | null,
  organizationId: string | null,
): PlannerCommandScope {
  return {
    tenantId,
    organizationId,
    requireTenant: true,
    requireOrganization: true,
  }
}

export function applyScopeToWhere<TEntity extends object>(
  where: FilterQuery<TEntity>,
  scope: PlannerCommandScope,
): FilterQuery<TEntity> {
  const scoped = { ...(where as Record<string, unknown>) }
  if (scope.requireTenant || scope.tenantId !== null) scoped.tenantId = scope.tenantId
  if (scope.requireOrganization || scope.organizationId !== null) scoped.organizationId = scope.organizationId
  return scoped as FilterQuery<TEntity>
}

export function scopeForDecryption(
  scope: PlannerCommandScope,
): { tenantId: string | null; organizationId: string | null } {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}
