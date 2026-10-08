import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import {
  defineProcessConfig,
  type ProcessActorDimensionContext,
} from '@open-mercato/shared/modules/insights/process'
import { StaffTeamMember } from './data/entities'

/**
 * Team of each actor for Process X-Ray breakdowns: the teams of the actor's active team
 * member records in the same organization (one query per batch of actors).
 */
export async function resolveActorTeams(ctx: ProcessActorDimensionContext, userIds: string[]): Promise<Record<string, string[]>> {
  const ids = Array.from(new Set(userIds.filter((id) => isUuid(id))))
  if (ids.length === 0) return {}
  const members = await findWithDecryption(
    ctx.em,
    StaffTeamMember,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: { $in: ids },
      isActive: true,
      deletedAt: null,
    },
    { fields: ['id', 'userId', 'teamId'] },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  const teams: Record<string, string[]> = {}
  for (const member of members) {
    if (!member.userId || !member.teamId) continue
    const list = teams[member.userId] ?? []
    if (!list.includes(member.teamId)) list.push(member.teamId)
    teams[member.userId] = list
  }
  return teams
}

export const processConfig = defineProcessConfig({
  version: 1,
  actorDimensions: [{ kind: 'team', resolve: resolveActorTeams }],
})

export default processConfig
