import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { StaffTeamMember } from '../data/entities'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

export type StaffCommandScope = {
  tenantId: string | null
  organizationId: string | null
  requireTenant: boolean
  requireOrganization: boolean
}

export function commandActorScope(ctx: CommandRuntimeContext): StaffCommandScope {
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

export function explicitStaffCommandScope(tenantId: string | null, organizationId: string | null): StaffCommandScope {
  return {
    tenantId,
    organizationId,
    requireTenant: true,
    requireOrganization: true,
  }
}

export function commandInputScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string): StaffCommandScope {
  if (ctx.auth?.isSuperAdmin === true || ctx.systemActor === true) {
    return explicitStaffCommandScope(tenantId, organizationId)
  }

  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)

  const actorTenantId = ctx.auth?.tenantId ?? ctx.organizationScope?.tenantId ?? null
  if (!actorTenantId || actorTenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }

  if (!ctx.organizationScope) {
    const currentOrganizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!currentOrganizationId || currentOrganizationId !== organizationId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
  }

  return explicitStaffCommandScope(tenantId, organizationId)
}

export function applyScopeToWhere<TEntity extends object>(
  where: FilterQuery<TEntity>,
  scope: StaffCommandScope,
): FilterQuery<TEntity> {
  const scoped = { ...(where as Record<string, unknown>) }
  if (scope.requireTenant || scope.tenantId !== null) scoped.tenantId = scope.tenantId
  if (scope.requireOrganization || scope.organizationId !== null) scoped.organizationId = scope.organizationId
  return scoped as FilterQuery<TEntity>
}

export function scopeForDecryption(scope: StaffCommandScope): { tenantId: string | null; organizationId: string | null } {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

export async function requireTeamMember(
  em: EntityManager,
  memberId: string,
  scope: StaffCommandScope,
  message = 'Team member not found',
): Promise<StaffTeamMember> {
  const member = await em.findOne(
    StaffTeamMember,
    applyScopeToWhere<StaffTeamMember>({ id: memberId, deletedAt: null }, scope),
  )
  if (!member) throw new CrudHttpError(404, { error: message })
  return member
}
