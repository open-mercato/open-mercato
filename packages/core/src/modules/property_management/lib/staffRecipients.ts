import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { BuildingManager } from '../data/entities'
import { MANAGE_ALL_BUILDINGS_FEATURE } from './buildingAccess'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export const MANAGE_ALL_CANDIDATE_CAP = 200

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export type StaffAudience = 'building' | 'administrators'

export type StaffRecipientInput = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  buildingId: string | null
  audience?: StaffAudience
}

function resolveRbac(container: AwilixContainer): RbacLike | null {
  try {
    return container.resolve('rbacService') as RbacLike
  } catch {
    return null
  }
}

export async function resolveManageAllHolders(
  container: AwilixContainer,
  em: EntityManager,
  scope: Scope,
): Promise<string[]> {
  const rbac = resolveRbac(container)
  if (!rbac) return []
  const candidates = await findWithDecryption(
    em,
    User,
    {
      tenantId: scope.tenantId,
      deletedAt: null,
      $or: [{ organizationId: scope.organizationId }, { organizationId: null }],
    },
    { limit: MANAGE_ALL_CANDIDATE_CAP + 1, orderBy: { id: 'asc' } },
    scope,
  )
  if (candidates.length > MANAGE_ALL_CANDIDATE_CAP) {
    logger.warn('Staff recipient candidates truncated', {
      organizationId: scope.organizationId,
      cap: MANAGE_ALL_CANDIDATE_CAP,
    })
  }
  const holders: string[] = []
  for (const user of candidates.slice(0, MANAGE_ALL_CANDIDATE_CAP)) {
    const allowed = await rbac.userHasAllFeatures(user.id, [MANAGE_ALL_BUILDINGS_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (allowed) holders.push(user.id)
  }
  return holders
}

export async function resolveStaffRecipients(input: StaffRecipientInput): Promise<string[]> {
  const { container, em, scope, buildingId } = input
  const audience = input.audience ?? 'building'
  const recipients = new Set<string>()
  if (audience === 'building' && buildingId) {
    const managers = await findWithDecryption(em, BuildingManager, { ...scope, buildingId }, undefined, scope)
    const managerIds = Array.from(new Set(managers.map((manager) => manager.userId)))
    const activeUsers = managerIds.length
      ? await findWithDecryption(em, User, { id: { $in: managerIds }, tenantId: scope.tenantId, deletedAt: null }, undefined, scope)
      : []
    for (const user of activeUsers) recipients.add(user.id)
  }
  for (const holder of await resolveManageAllHolders(container, em, scope)) recipients.add(holder)
  return Array.from(recipients).sort((left, right) => left.localeCompare(right))
}
