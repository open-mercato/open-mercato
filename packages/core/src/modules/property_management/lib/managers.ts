import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findEntityIdsBySearchTokens, type SearchTokenDatabase } from '@open-mercato/shared/lib/search/tokenLookup'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { E } from '#generated/entities.ids.generated'
import { BuildingManager } from '../data/entities'
import type { Scope } from './productUse'

export type ManagerSummary = { userId: string; name: string | null; email: string | null }

export const MANAGER_CANDIDATE_SCAN_CAP = 500

function organizationUsersWhere(scope: Scope): Record<string, unknown> {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
}

export async function filterOrganizationUsers(em: EntityManager, scope: Scope, userIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(userIds))
  if (!ids.length) return []
  const users = await findWithDecryption(
    em,
    User,
    { ...organizationUsersWhere(scope), id: { $in: ids } },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const found = new Set(users.map((user) => user.id))
  return ids.filter((id) => found.has(id))
}

export async function assertManagerUsers(em: EntityManager, scope: Scope, userIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(userIds))
  if (!ids.length) return []
  const found = new Set(await filterOrganizationUsers(em, scope, ids))
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

function toSummary(user: User): ManagerSummary {
  return { userId: user.id, name: user.name ?? null, email: user.email ?? null }
}

function matchesTerm(candidate: ManagerSummary, needle: string): boolean {
  return [candidate.name, candidate.email].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))
}

function compareCandidates(left: ManagerSummary, right: ManagerSummary): number {
  const byName = (left.name ?? left.email ?? '').localeCompare(right.name ?? right.email ?? '', undefined, { sensitivity: 'base' })
  if (byName !== 0) return byName
  return (left.email ?? '').localeCompare(right.email ?? '') || left.userId.localeCompare(right.userId)
}

async function findTokenMatchedUserIds(em: EntityManager, scope: Scope, term: string): Promise<string[]> {
  if (!term) return []
  const lookup = await findEntityIdsBySearchTokens({
    db: em.getKysely<SearchTokenDatabase>(),
    entityType: E.auth.user,
    query: term,
    scope: { tenantId: scope.tenantId },
  })
  return lookup.matched ? lookup.ids : []
}

export async function listManagerCandidates(em: EntityManager, scope: Scope, search: string | null, limit: number): Promise<ManagerSummary[]> {
  const term = search?.trim() ?? ''
  const where = organizationUsersWhere(scope)
  const tokenMatched = new Set(await findTokenMatchedUserIds(em, scope, term))
  const scanned = await findWithDecryption(em, User, where, { limit: MANAGER_CANDIDATE_SCAN_CAP, orderBy: { id: 'asc' } }, scope)
  const scannedIds = new Set(scanned.map((user) => user.id))
  const unscanned = Array.from(tokenMatched).filter((id) => !scannedIds.has(id)).slice(0, MANAGER_CANDIDATE_SCAN_CAP)
  const extra = unscanned.length
    ? await findWithDecryption(em, User, { ...where, id: { $in: unscanned } }, { limit: MANAGER_CANDIDATE_SCAN_CAP }, scope)
    : []
  const needle = term.toLocaleLowerCase()
  return [...scanned, ...extra]
    .map(toSummary)
    .filter((candidate) => !needle || tokenMatched.has(candidate.userId) || matchesTerm(candidate, needle))
    .sort(compareCandidates)
    .slice(0, limit)
}
