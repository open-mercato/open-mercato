import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  StaffIdentityProjection,
  StaffIdentityProjectionResolver,
  StaffIdentityProjectionScope,
} from '../contracts/identityProjectionResolver'
import { StaffTeamMember } from '../data/entities'

const uuidSchema = z.string().uuid()
const staffMemberIdsSchema = z.array(uuidSchema).max(100)

function assertValidScope(scope: StaffIdentityProjectionScope): void {
  if (
    !uuidSchema.safeParse(scope.tenantId).success
    || !uuidSchema.safeParse(scope.organizationId).success
  ) {
    throw new TypeError('Staff identity projection requires valid scope UUIDs')
  }
}

function mapProjection(member: StaffTeamMember): StaffIdentityProjection {
  return {
    staffMemberId: member.id,
    displayName: member.displayName,
    isActive: member.isActive,
  }
}

export function createStaffIdentityProjectionResolver(
  em: EntityManager,
): StaffIdentityProjectionResolver {
  return {
    async resolveByIds(scope, staffMemberIds) {
      assertValidScope(scope)
      const parsedIds = staffMemberIdsSchema.safeParse(staffMemberIds)
      if (!parsedIds.success) {
        throw new TypeError('Staff identity projection requires at most 100 valid UUIDs')
      }

      const uniqueIds = [...new Set(parsedIds.data)]
      if (uniqueIds.length === 0) return []

      const members = await findWithDecryption(
        em,
        StaffTeamMember,
        {
          id: { $in: uniqueIds },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )

      const projections = new Map<string, StaffIdentityProjection>()
      for (const member of members) {
        projections.set(member.id, mapProjection(member))
      }
      return [...projections.values()]
    },
  }
}
