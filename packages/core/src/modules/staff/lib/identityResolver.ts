import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import type {
  StaffIdentity,
  StaffIdentityResolver,
  StaffIdentityScope,
} from '../contracts/identityResolver'
import { StaffTeamMember } from '../data/entities'

const uuidSchema = z.string().uuid()

function assertValidLookup(scope: StaffIdentityScope, id: string): void {
  const values = [scope.tenantId, scope.organizationId, id]
  if (values.some((value) => !uuidSchema.safeParse(value).success)) {
    throw new TypeError('Staff identity lookup requires valid UUIDs')
  }
}

function mapIdentity(member: StaffTeamMember): StaffIdentity {
  return {
    staffMemberId: member.id,
    userId: member.userId ?? null,
    displayName: member.displayName,
    isActive: member.isActive,
  }
}

export function createStaffIdentityResolver(em: EntityManager): StaffIdentityResolver {
  return {
    async resolveByUserId(scope, userId) {
      assertValidLookup(scope, userId)
      const members = await findWithDecryption(
        em,
        StaffTeamMember,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId,
          isActive: true,
          deletedAt: null,
        },
        { limit: 2 },
        scope,
      )
      if (members.length === 0) return { kind: 'not_found' }
      if (members.length > 1) return { kind: 'ambiguous' }
      return { kind: 'found', identity: mapIdentity(members[0]) }
    },

    async resolveByStaffMemberId(scope, staffMemberId) {
      assertValidLookup(scope, staffMemberId)
      const member = await findOneWithDecryption(
        em,
        StaffTeamMember,
        {
          id: staffMemberId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          isActive: true,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      if (!member) return { kind: 'not_found' }
      return { kind: 'found', identity: mapIdentity(member) }
    },
  }
}
