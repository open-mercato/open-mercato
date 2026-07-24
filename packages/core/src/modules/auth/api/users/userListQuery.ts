import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { EntityName } from '@mikro-orm/core'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { E } from '#generated/entities.ids.generated'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { sql } from 'kysely'

export type UserFilter = FilterQuery<User>

export type UserListQuery = {
  id?: string
  page: number
  pageSize: number
  search?: string
  name?: string
  organizationId?: string
  roleIds?: string[]
}

// Request-bound scope resolved by the route controller and handed to queryUserList,
// which stays HTTP-agnostic (no Request, no container, no auth object).
export type ResolvedUserListScope = {
  baseFilters: UserFilter[]
  effectiveTenantId: string | null
  effectiveSelectedOrganizationId: string | null
  scopeOrganizationId: string | null
}

export type UserListQueryParams = {
  query: UserListQuery
  isSuperAdmin: boolean
  scope: ResolvedUserListScope
  authTenantId: string | null
}

export type UserListQueryResult =
  | { kind: 'roleFilterEmpty' }
  | { kind: 'searchEmpty' }
  | { kind: 'ok'; items: Array<Record<string, unknown>>; total: number }

// Answers the "list users" query: build the filter, fetch one page, project the rows.
export async function queryUserList(em: EntityManager, params: UserListQueryParams): Promise<UserListQueryResult> {
  const filter = await buildUserListFilters(em, params)
  if (filter.kind !== 'ok') return filter

  const { id, page, pageSize } = params.query
  const [rows, count] = await em.findAndCount(User, filter.where, { limit: pageSize, offset: (page - 1) * pageSize })

  const items = await mapUserListItems(em, {
    rows,
    includeHasPassword: Boolean(id),
    effectiveTenantId: params.scope.effectiveTenantId,
    scopeOrganizationId: params.scope.scopeOrganizationId,
    authTenantId: params.authTenantId,
  })
  return { kind: 'ok', items, total: count }
}

type BuildFiltersResult =
  | { kind: 'ok'; where: UserFilter }
  | { kind: 'roleFilterEmpty' }
  | { kind: 'searchEmpty' }

// Translates the parsed list query + resolved scope into a MikroORM `where`,
// or signals an empty result when a role/search filter matches nothing.
async function buildUserListFilters(em: EntityManager, params: UserListQueryParams): Promise<BuildFiltersResult> {
  const { query, isSuperAdmin, scope, authTenantId } = params
  const { id, search, name, organizationId, roleIds } = query
  const filters: UserFilter[] = [...scope.baseFilters]
  if (organizationId) filters.push({ organizationId })

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (trimmedName) {
    const nameTokenScope = isSuperAdmin ? (scope.effectiveTenantId ?? undefined) : authTenantId ?? null
    filters.push(await buildDisplayNameFilter(em, trimmedName, nameTokenScope))
  }

  let idFilter: Set<string> | null = id ? new Set([id]) : null
  if (Array.isArray(roleIds) && roleIds.length > 0) {
    const roleFilter = await resolveRoleIdFilter(em, roleIds, idFilter)
    if (!roleFilter.ok) return { kind: 'roleFilterEmpty' }
    idFilter = roleFilter.idFilter
  }

  const trimmedSearch = typeof search === 'string' ? search.trim() : ''
  if (trimmedSearch) {
    const tenantScope = isSuperAdmin ? (scope.effectiveTenantId ?? undefined) : authTenantId ?? null
    const searchFilters = await collectSearchFilters(em, trimmedSearch, tenantScope)
    if (!searchFilters.length) return { kind: 'searchEmpty' }
    filters.push(searchFilters.length > 1 ? { $or: searchFilters } : searchFilters[0])
  }

  if (idFilter && idFilter.size) {
    filters.push({ id: { $in: Array.from(idFilter) } } as UserFilter)
  } else if (id) {
    filters.push({ id })
  }

  return { kind: 'ok', where: filters.length > 1 ? { $and: filters } : filters[0] }
}

async function buildDisplayNameFilter(
  em: EntityManager,
  name: string,
  tenantScope: string | null | undefined,
): Promise<UserFilter> {
  const searchPattern = `%${escapeLikePattern(name)}%`
  const displayNameFilters: UserFilter[] = [{ name: { $ilike: searchPattern } } as UserFilter]
  const matchedIds = await findUserIdsBySearchTokens(em, E.auth.user, name, tenantScope, 'name')
  if (matchedIds && matchedIds.length) {
    displayNameFilters.push({ id: { $in: matchedIds } } as UserFilter)
  }
  return displayNameFilters.length > 1 ? { $or: displayNameFilters } : displayNameFilters[0]
}

async function resolveRoleIdFilter(
  em: EntityManager,
  roleIds: string[],
  idFilter: Set<string> | null,
): Promise<{ ok: true; idFilter: Set<string> } | { ok: false }> {
  const uniqueRoleIds = Array.from(new Set(roleIds))
  const linksForRoles = await em.find(
    UserRole,
    { role: { $in: uniqueRoleIds } } as unknown as FilterQuery<UserRole>,
  )
  const roleUserIds = new Set<string>()
  for (const link of linksForRoles) {
    const uid = resolveRefId((link as UserRole).user)
    if (uid) roleUserIds.add(uid)
  }
  if (roleUserIds.size === 0) return { ok: false }
  let nextFilter = idFilter
  if (nextFilter) {
    for (const uid of Array.from(nextFilter)) {
      if (!roleUserIds.has(uid)) nextFilter.delete(uid)
    }
  } else {
    nextFilter = roleUserIds
  }
  if (!nextFilter || nextFilter.size === 0) return { ok: false }
  return { ok: true, idFilter: nextFilter }
}

async function collectSearchFilters(
  em: EntityManager,
  search: string,
  tenantScope: string | null | undefined,
): Promise<UserFilter[]> {
  // Email is encrypted at rest, so plaintext search must go through search_tokens.
  const searchFilters: UserFilter[] = []

  const matchedIds = await findUserIdsBySearchTokens(em, E.auth.user, search, tenantScope)
  if (matchedIds && matchedIds.length) {
    searchFilters.push({ id: { $in: matchedIds } } as UserFilter)
  }

  const searchPattern = `%${escapeLikePattern(search)}%`
  const organizationSearchFilters: FilterQuery<Organization>[] = [
    { deletedAt: null },
    { name: { $ilike: searchPattern } } as FilterQuery<Organization>,
  ]
  if (tenantScope) {
    organizationSearchFilters.push({ tenant: tenantScope } as FilterQuery<Organization>)
  }
  const matchingOrganizations = await em.find(
    Organization,
    organizationSearchFilters.length > 1 ? { $and: organizationSearchFilters } : organizationSearchFilters[0],
  )
  const matchingOrganizationIds = matchingOrganizations
    .map((org) => (org?.id ? String(org.id) : null))
    .filter((orgId): orgId is string => typeof orgId === 'string' && orgId.length > 0)
  if (matchingOrganizationIds.length) {
    searchFilters.push({ organizationId: { $in: matchingOrganizationIds } } as UserFilter)
  }

  const roleSearchFilters: FilterQuery<Role>[] = [
    { deletedAt: null },
    { name: { $ilike: searchPattern } } as FilterQuery<Role>,
  ]
  if (tenantScope) {
    roleSearchFilters.push({ $or: [{ tenantId: tenantScope }, { tenantId: null }] } as FilterQuery<Role>)
  }
  const matchingRoles = await em.find(
    Role,
    roleSearchFilters.length > 1 ? { $and: roleSearchFilters } : roleSearchFilters[0],
  )
  const matchingRoleIds = matchingRoles
    .map((role) => (role?.id ? String(role.id) : null))
    .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
  if (matchingRoleIds.length) {
    const roleSearchLinks = await em.find(
      UserRole,
      { role: { $in: matchingRoleIds } } as unknown as FilterQuery<UserRole>,
    )
    const matchingRoleUserIds = Array.from(new Set(
      roleSearchLinks
        .map((link) => resolveRefId((link as UserRole).user))
        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
    ))
    if (matchingRoleUserIds.length) {
      searchFilters.push({ id: { $in: matchingRoleUserIds } } as UserFilter)
    }
  }

  return searchFilters
}

// Minimal structural view of the Kysely query builder used for search-token lookups.
// The builder is not exposed on the MikroORM EntityManager type surface.
type SearchTokenQueryBuilder = {
  selectFrom: (table: string) => SearchTokenQueryBuilder
  select: (column: string) => SearchTokenQueryBuilder
  where: (...args: unknown[]) => SearchTokenQueryBuilder
  groupBy: (column: string) => SearchTokenQueryBuilder
  having: (expression: unknown) => SearchTokenQueryBuilder
  execute: () => Promise<Array<{ entity_id?: unknown }>>
}

async function findUserIdsBySearchTokens(
  em: EntityManager,
  entityType: string,
  search: string,
  tenantScope: string | null | undefined,
  field?: string,
): Promise<string[] | null> {
  const trimmed = search.trim()
  if (!trimmed) return null
  const searchConfig = resolveSearchConfig()
  if (!searchConfig.enabled) return []
  const { hashes } = tokenizeText(trimmed, searchConfig)
  if (!hashes.length) return []

  const db = (em as unknown as { getKysely: () => SearchTokenQueryBuilder }).getKysely()
  let query = db
    .selectFrom('search_tokens')
    .select('entity_id')
    .where('entity_type', '=', entityType)
    .where('token_hash', 'in', hashes)
    .groupBy('entity_id')
    .having(sql<boolean>`count(distinct token_hash) >= ${hashes.length}`)
  if (field) {
    query = query.where('field', '=', field)
  }
  if (tenantScope !== undefined) {
    query = query.where(sql<boolean>`tenant_id is not distinct from ${tenantScope}`)
  }
  const rows = await query.execute()
  return rows
    .map((row) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

// Projects fetched user rows into API list items, resolving role names,
// organization/tenant names, and custom fields.
async function mapUserListItems(
  em: EntityManager,
  args: {
    rows: User[]
    includeHasPassword: boolean
    effectiveTenantId: string | null
    scopeOrganizationId: string | null
    authTenantId: string | null
  },
): Promise<Array<Record<string, unknown>>> {
  const { rows, includeHasPassword, effectiveTenantId, scopeOrganizationId, authTenantId } = args
  const userIds = rows.map((user) => user.id)
  const links = userIds.length
    ? await findWithDecryption(
        em,
        UserRole,
        { user: { $in: userIds } } as unknown as FilterQuery<UserRole>,
        { populate: ['role'] },
        {
          tenantId: effectiveTenantId ?? authTenantId ?? null,
          organizationId: scopeOrganizationId,
        },
      )
    : []
  const roleMap: Record<string, string[]> = {}
  const roleIdMap: Record<string, string[]> = {}
  for (const link of links) {
    const uid = resolveRefId((link as UserRole).user)
    if (!uid) continue
    const roleName = readStringField((link as UserRole).role, 'name')
    const roleId = readStringField((link as UserRole).role, 'id')
    if (!roleMap[uid]) roleMap[uid] = []
    if (!roleIdMap[uid]) roleIdMap[uid] = []
    if (roleName) roleMap[uid].push(roleName)
    if (roleId) roleIdMap[uid].push(roleId)
  }

  const orgMap = await buildEntityNameMap(em, Organization, collectIds(rows, (user) => user.organizationId))
  const tenantMap = await buildEntityNameMap(em, Tenant, collectIds(rows, (user) => user.tenantId))

  const tenantByUser: Record<string, string | null> = {}
  const organizationByUser: Record<string, string | null> = {}
  for (const user of rows) {
    const uid = String(user.id)
    tenantByUser[uid] = user.tenantId ? String(user.tenantId) : null
    organizationByUser[uid] = user.organizationId ? String(user.organizationId) : null
  }
  const customFieldsByUser = userIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.user,
        recordIds: userIds.map(String),
        tenantIdByRecord: tenantByUser,
        organizationIdByRecord: organizationByUser,
        tenantFallbacks: effectiveTenantId ? [effectiveTenantId] : authTenantId ? [authTenantId] : [],
      })
    : {}

  return rows.map((user) => {
    const uid = String(user.id)
    const orgId = user.organizationId ? String(user.organizationId) : null
    return {
      id: uid,
      email: String(user.email),
      name: user.name ? String(user.name) : null,
      organizationId: orgId,
      organizationName: orgId ? orgMap[orgId] ?? orgId : null,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      tenantName: user.tenantId ? tenantMap[String(user.tenantId)] ?? String(user.tenantId) : null,
      roles: roleMap[uid] || [],
      roleIds: roleIdMap[uid] || [],
      ...(includeHasPassword ? { hasPassword: !!user.passwordHash } : {}),
      updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : null,
      ...(customFieldsByUser[uid] || {}),
    }
  })
}

async function buildEntityNameMap<T extends { id: string }>(
  em: EntityManager,
  entity: EntityName<T>,
  ids: string[],
): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(ids))
  if (!uniqueIds.length) return {}
  const records = await em.find(entity, { id: { $in: uniqueIds }, deletedAt: null } as FilterQuery<T>)
  return records.reduce<Record<string, string>>((acc, record) => {
    const recordId = record?.id ? String(record.id) : null
    if (!recordId) return acc
    const name = readStringField(record, 'name')
    acc[recordId] = name.length > 0 ? name : recordId
    return acc
  }, {})
}

function collectIds(rows: User[], select: (user: User) => string | null | undefined): string[] {
  return rows
    .map((user) => {
      const value = select(user)
      return value ? String(value) : null
    })
    .filter((id): id is string => !!id)
}

function resolveRefId(ref: unknown): string | null {
  if (ref && typeof ref === 'object') {
    const id = (ref as { id?: unknown }).id
    if (id != null && String(id).length > 0) return String(id)
  }
  if (typeof ref === 'string' && ref.length > 0) return ref
  return null
}

function readStringField(source: unknown, field: string): string {
  if (source && typeof source === 'object') {
    const value = (source as Record<string, unknown>)[field]
    if (value != null) return String(value)
  }
  return ''
}
