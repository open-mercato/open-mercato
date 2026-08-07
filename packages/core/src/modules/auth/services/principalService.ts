import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type {
  AuthPrincipalLabel,
  AuthPrincipalRolePage,
  AuthPrincipalService,
  OrganizationHierarchyService,
  PrincipalScope,
} from '@open-mercato/shared/lib/auth/principal-service'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, RoleAcl, User, UserRole } from '../data/entities'
import { listSuperAdminUserIds } from '../lib/grantChecks'
import { resolveRoleOrganizationScope, roleAclGrantsPrincipalOrganization } from './roleOrganizationScope'

const MAX_ROLE_PAGE_SIZE = 100
const MAX_ROLE_RESULTS = 1_000

type AuthPrincipalDatabase = {
  roles: {
    id: string
    tenant_id: string
    name: string
    deleted_at: Date | null
  }
  role_acls: {
    role_id: string
    tenant_id: string
    organizations_json: string[] | null
    deleted_at: Date | null
  }
}

function normalizeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null
}

export class DefaultAuthPrincipalService implements AuthPrincipalService {
  constructor(
    private readonly em: EntityManager,
    private readonly organizationHierarchyService?: OrganizationHierarchyService,
  ) {}

  async principalExists(input: {
    type: 'user' | 'role'
    id: string
    scope: PrincipalScope
  }): Promise<boolean> {
    if (input.type === 'role') {
      return (await this.filterActiveRoleIds([input.id], input.scope)).includes(input.id)
    }
    return Boolean(await findOneWithDecryption(
      this.em,
      User,
      {
        id: input.id,
        tenantId: input.scope.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: input.scope.organizationId }],
      } as FilterQuery<User>,
      { fields: ['id'] as const },
      input.scope,
    ))
  }

  async resolveActiveUserRoleIds(userId: string, scope: PrincipalScope): Promise<string[]> {
    const links = await findWithDecryption(
      this.em,
      UserRole,
      {
        user: userId,
        deletedAt: null,
        role: { tenantId: scope.tenantId, deletedAt: null },
      } as FilterQuery<UserRole>,
      { fields: ['role'] as const },
      scope,
    )
    return this.filterActiveRoleIds(
      normalizeIds(links.flatMap((link) => {
        const id = relationId(link.role)
        return id ? [id] : []
      })),
      scope,
    )
  }

  async filterActiveRoleIds(roleIds: string[], scope: PrincipalScope): Promise<string[]> {
    const ids = normalizeIds(roleIds)
    if (ids.length === 0) return []
    const roles = await findWithDecryption(
      this.em,
      Role,
      { id: { $in: ids }, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<Role>,
      { fields: ['id'] as const },
      scope,
    )
    const activeIds = normalizeIds(roles.map((role) => role.id))
    if (activeIds.length === 0) return []
    const roleOrganizationScope = await resolveRoleOrganizationScope(
      this.organizationHierarchyService,
      scope.tenantId,
      scope.organizationId,
    )
    const acls = await findWithDecryption(
      this.em,
      RoleAcl,
      {
        tenantId: scope.tenantId,
        role: { $in: activeIds },
        deletedAt: null,
      } as FilterQuery<RoleAcl>,
      { fields: ['role', 'organizationsJson'] as const },
      scope,
    )
    const eligibilityById = new Map<string, boolean>()
    for (const acl of acls) {
      const id = relationId(acl.role)
      if (!id) continue
      eligibilityById.set(
        id,
        eligibilityById.get(id) === true || roleAclGrantsPrincipalOrganization(acl, roleOrganizationScope),
      )
    }
    // A tenant role without an ACL remains a valid explicit-share principal.
    // Only an existing ACL can restrict that role away from this organization.
    return activeIds.filter((id) => eligibilityById.get(id) !== false)
  }

  async resolveLabels(input: {
    type: 'user' | 'role'
    ids: string[]
    scope: PrincipalScope
  }): Promise<AuthPrincipalLabel[]> {
    const ids = normalizeIds(input.ids)
    if (ids.length === 0) return []
    if (input.type === 'role') {
      const eligibleIds = await this.filterActiveRoleIds(ids, input.scope)
      if (eligibleIds.length === 0) return []
      const roles = await findWithDecryption(
        this.em,
        Role,
        { id: { $in: eligibleIds }, tenantId: input.scope.tenantId, deletedAt: null } as FilterQuery<Role>,
        { fields: ['id', 'name'] as const },
        input.scope,
      )
      return roles.map((role) => ({ id: role.id, label: role.name, secondary: null }))
    }
    const users = await findWithDecryption(
      this.em,
      User,
      {
        id: { $in: ids },
        tenantId: input.scope.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: input.scope.organizationId }],
      } as FilterQuery<User>,
      { fields: ['id', 'name', 'email'] as const },
      input.scope,
    )
    return users.map((user) => ({
      id: user.id,
      label: user.name?.trim() || user.email,
      secondary: user.name?.trim() && user.email !== user.name.trim() ? user.email : null,
    }))
  }

  async queryActiveRolePage(input: {
    scope: PrincipalScope
    search?: string
    excludedIds?: string[]
    page: number
    pageSize: number
  }): Promise<AuthPrincipalRolePage> {
    const page = Math.max(1, Math.floor(input.page))
    const pageSize = Math.min(MAX_ROLE_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize)))
    const offset = (page - 1) * pageSize
    const excludedIds = normalizeIds(input.excludedIds ?? [])
    const roleOrganizationScope = await resolveRoleOrganizationScope(
      this.organizationHierarchyService,
      input.scope.tenantId,
      input.scope.organizationId,
    )
    const db = this.em.getKysely<AuthPrincipalDatabase>()
    let eligibleRoles = db
      .selectFrom('roles as r')
      .where('r.tenant_id', '=', input.scope.tenantId)
      .where('r.deleted_at', 'is', null)

    if (roleOrganizationScope) {
      const allowedOrganizations = Array.from(roleOrganizationScope)
      const organizationPredicates = [
        sql<boolean>`ra.organizations_json is null`,
        sql<boolean>`ra.organizations_json::jsonb @> ${JSON.stringify(['__all__'])}::jsonb`,
        ...allowedOrganizations.map((organizationId) => (
          sql<boolean>`ra.organizations_json::jsonb @> ${JSON.stringify([organizationId])}::jsonb`
        )),
      ]
      const organizationAllowed = sql<boolean>`(${sql.join(organizationPredicates, sql` or `)})`
      eligibleRoles = eligibleRoles.where(sql<boolean>`(
        not exists (
          select 1
          from role_acls as ra_any
          where ra_any.role_id = r.id
            and ra_any.tenant_id = ${input.scope.tenantId}
            and ra_any.deleted_at is null
        )
        or exists (
          select 1
          from role_acls as ra
          where ra.role_id = r.id
            and ra.tenant_id = ${input.scope.tenantId}
            and ra.deleted_at is null
            and ${organizationAllowed}
        )
      )`)
    }
    if (input.search?.trim()) {
      const searchPattern = `%${escapeLikePattern(input.search.trim())}%`
      eligibleRoles = eligibleRoles.where(sql<boolean>`r.name ilike ${searchPattern}`)
    }
    if (excludedIds.length > 0) {
      eligibleRoles = eligibleRoles.where('r.id', 'not in', excludedIds)
    }

    const boundedRoleIds = eligibleRoles
      .select('r.id')
      .limit(MAX_ROLE_RESULTS)
      .as('bounded_roles')
    const countQuery = db
      .selectFrom(boundedRoleIds)
      .select(sql<string>`count(*)`.as('count'))
    const pageQuery = eligibleRoles
      .select(['r.id', 'r.name'])
      .orderBy('r.id', 'asc')
      .limit(offset < MAX_ROLE_RESULTS ? Math.min(pageSize, MAX_ROLE_RESULTS - offset) : 0)
      .offset(Math.min(offset, MAX_ROLE_RESULTS))

    const [rows, countRow] = await Promise.all([
      pageQuery.execute() as Promise<Array<{ id: string; name: string }>>,
      countQuery.executeTakeFirst() as Promise<{ count?: string | number } | undefined>,
    ])
    const parsedTotal = Number(countRow?.count ?? 0)
    const total = Number.isFinite(parsedTotal)
      ? Math.min(MAX_ROLE_RESULTS, Math.max(0, Math.floor(parsedTotal)))
      : 0

    return {
      items: rows.map((role) => ({ id: role.id, label: role.name, secondary: null })),
      page,
      pageSize,
      total,
    }
  }

  async listSuperAdminUserIds(tenantId: string): Promise<string[]> {
    return Array.from(await listSuperAdminUserIds(this.em, tenantId))
  }
}
