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

export async function requireTeamMember(
  em: EntityManager,
  memberId: string,
  message = 'Team member not found',
): Promise<StaffTeamMember> {
  const member = await em.findOne(StaffTeamMember, { id: memberId })
  if (!member) throw new CrudHttpError(404, { error: message })
  return member
}
