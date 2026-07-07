import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember } from '../data/entities'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export { ensureOrganizationScope, extractUndoPayload }

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
  message = 'Team member not found',
  scope?: StaffSnapshotScope | null,
): Promise<StaffTeamMember> {
  const member = await em.findOne(StaffTeamMember, scopedStaffSnapshotWhere(memberId, scope))
  if (!member) throw new CrudHttpError(404, { error: message })
  return member
}
