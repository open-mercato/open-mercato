import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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

export type StaffSnapshotScope = {
  tenantId?: string | null
  organizationId?: string | null
}

type StaffSnapshotScopeSource = {
  tenantId?: string | null
  organizationId?: string | null
}

const NULL_DECRYPTION_SCOPE = { tenantId: null, organizationId: null } as const

export function staffSnapshotScopeFromContext(ctx: CommandRuntimeContext): StaffSnapshotScope | null {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) return null
  return { tenantId }
}

export function staffSnapshotScopeFromSnapshot(source: StaffSnapshotScopeSource | null | undefined): StaffSnapshotScope | null {
  if (!source?.tenantId || !source.organizationId) return null
  return { tenantId: source.tenantId, organizationId: source.organizationId }
}

export function scopedStaffSnapshotWhere(id: string, scope?: StaffSnapshotScope | null) {
  const where: { id: string; tenantId?: string; organizationId?: string } = { id }
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

export function staffSnapshotDecryptionScope(scope?: StaffSnapshotScope | null) {
  if (!scope) return NULL_DECRYPTION_SCOPE
  return {
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
  }
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
