import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { BuildingManager } from '../data/entities'
import type { Scope } from './productUse'

export type ManagerSummary = { userId: string; name: string | null; email: string | null }

export async function assertManagerUsers(em: EntityManager, scope: Scope, userIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(userIds))
  if (!ids.length) return []
  const users = await findWithDecryption(
    em,
    User,
    { id: { $in: ids }, tenantId: scope.tenantId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const found = new Set(users.map((user) => user.id))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length) {
    const { translate } = await resolveTranslations()
    const message = translate('property_management.errors.managerNotFound', 'One of the selected managers is not a user of this organization.')
    throw new CrudHttpError(422, { error: message, fieldErrors: { managerUserIds: message } })
  }
  return ids
}

export async function loadManagerIds(em: EntityManager, scope: Scope, buildingId: string): Promise<string[]> {
  const rows = await findWithDecryption(em, BuildingManager, { ...scope, buildingId }, undefined, scope)
  return rows.map((row) => row.userId).sort((left, right) => left.localeCompare(right))
}

export async function replaceManagers(em: EntityManager, scope: Scope, buildingId: string, userIds: readonly string[]): Promise<void> {
  const rows = await findWithDecryption(em, BuildingManager, { ...scope, buildingId }, undefined, scope)
  const wanted = new Set(userIds)
  const existing = new Set(rows.map((row) => row.userId))
  for (const row of rows) {
    if (!wanted.has(row.userId)) em.remove(row)
  }
  for (const userId of wanted) {
    if (existing.has(userId)) continue
    em.persist(em.create(BuildingManager, { ...scope, buildingId, userId }))
  }
}

export async function listBuildingManagers(
  em: EntityManager,
  scope: Scope,
  buildingIds: readonly string[],
): Promise<Map<string, ManagerSummary[]>> {
  const result = new Map<string, ManagerSummary[]>()
  if (!buildingIds.length) return result
  const rows = await findWithDecryption(em, BuildingManager, { ...scope, buildingId: { $in: [...buildingIds] } }, undefined, scope)
  const userIds = Array.from(new Set(rows.map((row) => row.userId)))
  const users = userIds.length
    ? await findWithDecryption(em, User, { id: { $in: userIds }, tenantId: scope.tenantId }, undefined, scope)
    : []
  const usersById = new Map(users.map((user) => [user.id, user]))
  for (const row of rows) {
    const user = usersById.get(row.userId)
    const list = result.get(row.buildingId) ?? []
    list.push({ userId: row.userId, name: user?.name ?? null, email: user?.email ?? null })
    result.set(row.buildingId, list)
  }
  return result
}

export async function listManagerCandidates(em: EntityManager, scope: Scope, search: string | null, limit: number): Promise<ManagerSummary[]> {
  const term = search?.trim()
  const where: Record<string, unknown> = { tenantId: scope.tenantId, deletedAt: null }
  if (term) where.name = { $ilike: `%${escapeLikePattern(term)}%` }
  const users = await findWithDecryption(em, User, where, { limit, orderBy: { name: 'asc' } }, scope)
  return users.map((user) => ({ userId: user.id, name: user.name ?? null, email: user.email ?? null }))
}
