import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember } from '../data/entities'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

export async function requireTeamMember(
  em: EntityManager,
  memberId: string,
  message = 'Team member not found',
): Promise<StaffTeamMember> {
  const member = await em.findOne(StaffTeamMember, { id: memberId })
  if (!member) throw new CrudHttpError(404, { error: message })
  return member
}
