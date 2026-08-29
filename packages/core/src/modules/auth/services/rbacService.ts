import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import { UserAcl, RoleAcl, Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import { buildOrgScopeUserCacheTag, buildOrgScopeTenantCacheTag } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  authorizeFeatures,
  resolveEffectiveFeatures,
} from '@open-mercato/shared/security/featurePolicy'
import { filterGrantsByEnabledModules } from '@open-mercato/shared/security/enabledModulesRegistry'
import { resolveRoleOrganizationScope, roleAclAllowsOrganization } from './roleOrganizationScope'

interface AclData {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

function isAclData(value: unknown): value is AclData {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<AclData>
  if (typeof record.isSuperAdmin !== 'boolean') return false
  if (!Array.isArray(record.features) || record.features.some((feature) => typeof feature !== 'string')) return false
  if (record.organizations !== null && record.organizations !== undefined) {
    if (!Array.isArray(record.organizations)) return false
    if (record.organizations.some((org) => typeof org !== 'string')) return false
  }
  return true
}

function isRestrictedRoleAcl(acl: Pick<RoleAcl, 'organizationsJson'>): boolean {
  return Array.isArray(acl.organizationsJson)
    && acl.organizationsJson.length > 0
    && !acl.organizationsJson.includes('__all__')
}

export class RbacService {
  private cacheTtlMs: number = 5 * 60 * 1000 // 5 minutes default
  private cache: CacheStrategy | null = null
  private globalSuperAdminCache = new Map<string, boolean>()

  constructor(
    private em: EntityManager,
    cache?: CacheStrategy,
    private readonly organizationHierarchyService?: OrganizationHierarchyService,
  ) {
    this.cache = cache || null
  }

  /**
   * Set cache TTL in milliseconds
   * @param ttlMs - Time to live in milliseconds
   */
  setCacheTtl(ttlMs: number) {
    this.cacheTtlMs = ttlMs
  }

  /** Compatibility wrapper for callers that already have both feature lists. */
  public hasAllFeatures(required: string[], granted: string[]): boolean {
    return authorizeFeatures(required, { grantedFeatures: granted })
  }

  private getCacheKey(userId: string, scope: { tenantId: string | null; organizationId: string | null }): string {
    return `rbac:${userId}:${scope.tenantId || 'null'}:${scope.organizationId || 'null'}`
  }

  private getUserTag(userId: string): string {
    return `rbac:user:${userId}`
  }

  private getTenantTag(tenantId: string): string {
    return `rbac:tenant:${tenantId}`
  }

  private getOrganizationTag(organizationId: string): string {
    return `rbac:org:${organizationId}`
  }

  private async getFromCache(cacheKey: string): Promise<AclData | null> {
    if (!this.cache) return null
    const cached = await this.cache.get(cacheKey)
    if (!cached) return null
    return isAclData(cached) ? cached : null
  }

  private async setCache(cacheKey: string, data: AclData, userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<void> {
    if (!this.cache) return

    const tags = [
      this.getUserTag(userId),
      'rbac:all'
    ]

    if (scope.tenantId) {
      tags.push(this.getTenantTag(scope.tenantId))
      // Scoped role projections depend on the selected organization's ancestor
      // chain, so Directory hierarchy changes must evict them as well as the
      // separately cached OrganizationScope entries.
      tags.push(buildOrgScopeTenantCacheTag(scope.tenantId))
    }

    if (scope.organizationId) {
      tags.push(this.getOrganizationTag(scope.organizationId))
    }

    await this.cache.set(cacheKey, data, {
      ttl: this.cacheTtlMs,
      tags
    })
  }

  /**
   * Invalidates cached ACL data for a specific user across all tenants and organizations.
   * Call this when a user's roles or user-specific ACL is modified.
   * 
   * @param userId - The ID of the user whose cache should be invalidated
   */
  async invalidateUserCache(userId: string): Promise<void> {
    this.globalSuperAdminCache.delete(userId)
    // Also drop the directory OrganizationScope cache for this user. That scope's
    // accessible-org set is derived from this user's ACL/role grants, so any
    // permission change that invalidates the RBAC cache must invalidate the
    // resolved scope too. This is the missing `org-scope:user:*` caller required
    // before the cross-request scope TTL can be safely enabled (issue #2259).
    await this.deleteCacheByTags([this.getUserTag(userId), buildOrgScopeUserCacheTag(userId)])
  }

  /**
   * Invalidates cached ACL data for all users within a specific tenant.
   * Call this when a role's ACL is modified, since roles are tenant-scoped
   * and affect all users in that tenant who have that role.
   * 
   * @param tenantId - The ID of the tenant whose cache should be invalidated
   */
  async invalidateTenantCache(tenantId: string): Promise<void> {
    this.globalSuperAdminCache.clear()
    // Role ACL changes invalidate every user in the tenant; the resolved
    // OrganizationScope for those users derives from the same grants, so drop
    // the tenant-tagged scope entries alongside the RBAC ones (issue #2259).
    await this.deleteCacheByTags([this.getTenantTag(tenantId), buildOrgScopeTenantCacheTag(tenantId)], [tenantId])
  }

  /**
   * Invalidates cached ACL data for all users within a specific organization.
   * Call this when organization-level permissions or visibility changes.
   * 
   * @param organizationId - The ID of the organization whose cache should be invalidated
   */
  async invalidateOrganizationCache(organizationId: string): Promise<void> {
    await this.deleteCacheByTags([this.getOrganizationTag(organizationId)])
  }

  /**
   * Clears all cached ACL data.
   * Use this for bulk operations or system-wide ACL changes.
   */
  async invalidateAllCache(): Promise<void> {
    this.globalSuperAdminCache.clear()
    await this.deleteCacheByTags(['rbac:all'])
  }

  private async deleteCacheByTags(tags: string[], tenantHints?: Array<string | null>): Promise<void> {
    if (!this.cache) return
    const contexts = new Set<string | null>()
    const current = getCurrentCacheTenant()
    contexts.add(current ?? null)
    contexts.add(null)
    if (Array.isArray(tenantHints)) {
      for (const hint of tenantHints) {
        contexts.add(hint ?? null)
      }
    }
    for (const ctx of contexts) {
      if (ctx === current) {
        await this.cache.deleteByTags(tags)
      } else {
        await runWithCacheTenant(ctx, async () => {
          await this.cache!.deleteByTags(tags)
        })
      }
    }
  }

  // A super-admin grant is deliberately GLOBAL: it survives every scope the
  // caller asks about, which is what lets a platform super-admin work inside a
  // customer tenant. What it must not do is survive the question of whose grant
  // it is. Both lookups below are therefore evaluated against the user's OWN
  // tenant (`users.tenant_id`), never against no tenant at all.
  //
  // Without that binding a single `user_acls` row — or a role link — stamped
  // with ANY tenant confers platform super-admin everywhere, so a row written
  // under the wrong tenant becomes a full privilege escalation with nothing in
  // the schema or the UI to show for it. `user_acls` has no organization column
  // and no uniqueness beyond its primary key, so such a row is cheap to create
  // and invisible to the tenant/organization cross-wire checks.
  //
  // This is the tenant binding `resolveCanonicalStaffAuthContext` already
  // applies when it computes `auth.isSuperAdmin` (see lib/sessionIntegrity.ts:
  // `userAclGrantsSuperAdmin` / `roleAclGrantsSuperAdmin`, both bound to the
  // user's own tenant). Before this change the two authorities disagreed:
  // session integrity would say "not a super-admin" while `loadAcl` handed the
  // same request `['*']`.
  //
  // The memo stays keyed by `userId` alone because the answer now depends only
  // on the user's own tenant, which is a property of the user — not on the scope
  // being asked about. `invalidateUserCache` therefore still clears it correctly.
  private async isGlobalSuperAdmin(
    em: EntityManager,
    userId: string,
    userTenantId: string | null,
  ): Promise<boolean> {
    if (this.globalSuperAdminCache.has(userId)) return this.globalSuperAdminCache.get(userId)!
    if (!userTenantId) {
      // A user with no tenant of their own has no tenant to be a super-admin of.
      this.globalSuperAdminCache.set(userId, false)
      return false
    }
    const userSuper = await em.findOne(UserAcl, {
      user: userId as unknown as User,
      tenantId: userTenantId,
      isSuperAdmin: true,
      deletedAt: null,
    } as FilterQuery<UserAcl>)
    if (userSuper?.isSuperAdmin) {
      this.globalSuperAdminCache.set(userId, true)
      return true
    }
    const links = await findWithDecryption(
      em,
      UserRole,
      // Roles that belong to the user's own tenant, as
      // `resolveCanonicalStaffAuthContext` already requires. The encryption
      // scope stays `{ null, null }` as before — this change is about which rows
      // count, not about which key decrypts them.
      {
        user: userId as unknown as User,
        deletedAt: null,
        role: { tenantId: userTenantId, deletedAt: null },
      } as FilterQuery<UserRole>,
      { populate: ['role'] },
      { tenantId: null, organizationId: null },
    )
    const linkList = Array.isArray(links) ? links : []
    if (!linkList.length) {
      this.globalSuperAdminCache.set(userId, false)
      return false
    }
    const roleIds = Array.from(new Set(linkList.map((link) => {
      const role = link.role
      return role?.id ? String(role.id) : null
    }).filter((id): id is string => typeof id === 'string' && id.length > 0)))
    if (!roleIds.length) {
      this.globalSuperAdminCache.set(userId, false)
      return false
    }
    const roleSupers = await em.find(RoleAcl, {
      isSuperAdmin: true,
      tenantId: userTenantId,
      deletedAt: null,
      role: { $in: roleIds as unknown as Role[] },
    } as FilterQuery<RoleAcl>)
    const result = roleSupers.some((roleAcl) => (
      !!roleAcl.isSuperAdmin && !isRestrictedRoleAcl(roleAcl)
    ))
    this.globalSuperAdminCache.set(userId, result)
    return result
  }

  /**
   * Loads the Access Control List (ACL) for a user within a given scope.
   * 
   * The ACL resolution follows this priority:
   * 1. Per-user ACL (UserAcl) - if exists, use it exclusively
   * 2. Aggregated role ACLs (RoleAcl) - combine permissions from all user's roles
   * 
   * Results are cached for performance (default 5 minutes TTL).
   * Cache is automatically invalidated when ACL-related data changes.
   * 
   * @param userId - The ID of the user
   * @param scope - The tenant and organization context for ACL evaluation
   * @returns An object containing:
   *   - isSuperAdmin: If true, user has unrestricted access to all features
   *   - features: Array of feature strings (may include wildcards like 'entities.*')
   *   - organizations: Array of organization IDs user can access, or null for all organizations
   * 
   * @example
   * const acl = await rbacService.loadAcl('user-123', { tenantId: 'tenant-1', organizationId: 'org-1' })
   * // Returns: { isSuperAdmin: false, features: ['users.view', 'entities.*'], organizations: ['org-1', 'org-2'] }
   */
  async loadAcl(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<{
    isSuperAdmin: boolean
    features: string[]
    organizations: string[] | null
  }> {
    const cacheKey = this.getCacheKey(userId, scope)
    const cached = await this.getFromCache(cacheKey)
    if (cached) return cached

    if (userId.startsWith('api_key:')) {
      const apiKeyId = userId.slice('api_key:'.length)
      const em = this.em.fork()
      const key = await em.findOne(ApiKey, { id: apiKeyId, deletedAt: null })
      if (!key || (key.expiresAt && key.expiresAt.getTime() < Date.now())) {
        const result = { isSuperAdmin: false, features: [], organizations: null }
        await this.setCache(cacheKey, result, userId, scope)
        return result
      }
      const tenantId = scope.tenantId || key.tenantId || null
      const roleIds = Array.isArray(key.rolesJson) ? key.rolesJson.filter(Boolean) : []
      const keyOrganizationId = typeof key.organizationId === 'string' && key.organizationId.trim().length > 0
        ? key.organizationId.trim()
        : null
      const evaluatedOrganizationId = scope.organizationId || keyOrganizationId
      let isSuper = false
      const features: string[] = []
      let roleOrganizations: string[] | null = []
      let hasApplicableRestrictedRole = false
      if (tenantId && roleIds.length) {
        const roleOrganizationScope = await resolveRoleOrganizationScope(
          this.organizationHierarchyService,
          tenantId,
          evaluatedOrganizationId,
        )
        const racls = await em.find(RoleAcl, {
          tenantId,
          deletedAt: null,
          role: { $in: roleIds as unknown as Role[] },
        } as FilterQuery<RoleAcl>)
        for (const acl of racls) {
          if (roleAclAllowsOrganization(acl, roleOrganizationScope)) {
            isSuper = isSuper || !!acl.isSuperAdmin
            if (Array.isArray(acl.featuresJson)) {
              for (const f of acl.featuresJson) if (!features.includes(f)) features.push(f)
            }
            if (isRestrictedRoleAcl(acl)) hasApplicableRestrictedRole = true
          }
          if (roleOrganizations !== null) {
            if (acl.organizationsJson == null || (Array.isArray(acl.organizationsJson) && acl.organizationsJson.length === 0)) {
              roleOrganizations = null
            } else if (Array.isArray(acl.organizationsJson) && acl.organizationsJson.includes('__all__')) {
              roleOrganizations = null
            } else {
              roleOrganizations = Array.from(new Set([
                ...roleOrganizations,
                ...(Array.isArray(acl.organizationsJson) ? acl.organizationsJson : []),
              ]))
            }
          }
        }
        if (
          roleOrganizations !== null
          && evaluatedOrganizationId
          && roleOrganizationScope !== null
          && roleOrganizationScope.size > 0
          && hasApplicableRestrictedRole
          && !roleOrganizations.includes(evaluatedOrganizationId)
        ) {
          roleOrganizations.push(evaluatedOrganizationId)
        }
      }
      let organizations = roleOrganizations
      if (keyOrganizationId) {
        const keyOrganizationScope = await resolveRoleOrganizationScope(
          this.organizationHierarchyService,
          tenantId,
          keyOrganizationId,
        )
        organizations = roleOrganizations === null
          || roleOrganizations.some((organizationId) => keyOrganizationScope?.has(organizationId))
          ? [keyOrganizationId]
          : []
      }
      // A role-level super-admin grant still respects the API key's effective
      // organization allowlist. Represent it as a wildcard feature whenever
      // the key is restricted so downstream super-admin shortcuts cannot
      // bypass the key or role organization bounds.
      if (isSuper && organizations !== null && !features.includes('*')) features.push('*')
      const result = { isSuperAdmin: isSuper && organizations === null, features, organizations }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Use a forked EntityManager to avoid inheriting an aborted transaction from callers
    const em = this.em.fork()
    const user = await em.findOne(User, { id: userId })
    if (!user) {
      const result = { isSuperAdmin: false, features: [], organizations: null }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Direct user-level super-admin grants and unrestricted role-level
    // super-admin grants are global. Organization-restricted role grants are
    // deliberately excluded by isGlobalSuperAdmin and continue through the
    // scoped ACL projection below.
    //
    // The check runs AFTER the user is loaded because it is evaluated against
    // the user's own tenant — see isGlobalSuperAdmin. It reuses that load and
    // that EntityManager rather than issuing its own, so the reordering costs
    // no extra query. API-key principals never reached it and still do not:
    // their branch above has already returned.
    if (await this.isGlobalSuperAdmin(em, userId, user.tenantId ?? null)) {
      const result = { isSuperAdmin: true, features: ['*'], organizations: null }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    const tenantId = scope.tenantId || user.tenantId || null
    const orgId = scope.organizationId || user.organizationId || null

    if (!tenantId) {
      const result = { isSuperAdmin: false, features: [], organizations: null }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Per-user ACL first. This row REPLACES the role ACLs rather than merging
    // with them, so which row is returned decides the whole feature set. A
    // partial unique index now makes a second live row impossible
    // (`user_acls_active_unique_idx`, Migration20260828120000_auth), but the
    // ordering is stated anyway: an index can be dropped by an operator, and an
    // unordered `findOne` over a table that used to allow duplicates is exactly
    // the read this pairs with. Soft-deleted rows are excluded — a revoked
    // override must not keep answering.
    const uacl = await em.findOne(
      UserAcl,
      { user: userId as unknown as User, tenantId, deletedAt: null } as FilterQuery<UserAcl>,
      // `createdAt`/`id`, not `updatedAt`: `updated_at` is nullable and Postgres
      // sorts NULLs FIRST under DESC, so ordering by it would prefer a row that
      // was never updated. The migration's one-time collapse uses
      // `coalesce(updated_at, created_at)` because there it is picking the row
      // an operator would call current; here the only requirement is that the
      // answer not vary between requests.
      { orderBy: { createdAt: 'desc', id: 'desc' } } as const,
    )
    if (uacl) {
      const result = {
        isSuperAdmin: !!uacl.isSuperAdmin,
        features: Array.isArray(uacl.featuresJson) ? (uacl.featuresJson as string[]) : [],
        organizations: Array.isArray(uacl.organizationsJson) ? (uacl.organizationsJson as string[]) : null,
      }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Aggregate role ACLs
    const links = await findWithDecryption(
      em,
      UserRole,
      {
        user: userId as unknown as User,
        deletedAt: null,
        role: { tenantId, deletedAt: null },
      } as FilterQuery<UserRole>,
      { populate: ['role'] },
      { tenantId, organizationId: orgId },
    )
    const linkList = Array.isArray(links) ? links : []
    const roleIds = linkList
      .map((link) => link.role?.id ? String(link.role.id) : null)
      .filter((roleId): roleId is string => roleId !== null)
    let isSuper = false
    const features: string[] = []
    let organizations: string[] | null = []
    let hasApplicableRestrictedRole = false
    if (roleIds.length) {
      const roleOrganizationScope = await resolveRoleOrganizationScope(
        this.organizationHierarchyService,
        tenantId,
        scope.organizationId,
      )
      const racls = await em.find(RoleAcl, {
        tenantId,
        deletedAt: null,
        role: { $in: roleIds as unknown as Role[] },
      } as FilterQuery<RoleAcl>, {})
      const roleAcls = Array.isArray(racls) ? racls : []
      for (const r of roleAcls) {
        if (roleAclAllowsOrganization(r, roleOrganizationScope)) {
          isSuper = isSuper || !!r.isSuperAdmin
          if (Array.isArray(r.featuresJson)) for (const f of r.featuresJson) if (!features.includes(f)) features.push(f)
          if (isRestrictedRoleAcl(r)) hasApplicableRestrictedRole = true
        }
        if (organizations !== null) {
          // For a user principal an empty allowlist is a deny-all scope (#4033), not
          // "unrestricted": it must merge to an empty set so scoped reads and deletes
          // fail closed. Only an absent allowlist or an explicit '__all__' widens to
          // every organization. (The API-key branch above deliberately differs — an
          // empty role list there means the key inherits the key's own scope.)
          if (r.organizationsJson == null) organizations = null
          else if (Array.isArray(r.organizationsJson) && r.organizationsJson.includes('__all__')) organizations = null
          else organizations = Array.from(new Set([...(organizations || []), ...r.organizationsJson]))
        }
      }
      if (
        organizations !== null
        && scope.organizationId
        && roleOrganizationScope !== null
        && roleOrganizationScope.size > 0
        && hasApplicableRestrictedRole
        && !organizations.includes(scope.organizationId)
      ) {
        organizations.push(scope.organizationId)
      }
    }
    if (organizations && orgId && !organizations.includes(orgId) && !organizations.includes('__all__')) {
      // Out-of-scope org; caller will enforce
    }
    const result = { isSuperAdmin: isSuper, features, organizations }
    await this.setCache(cacheKey, result, userId, scope)
    return result
  }

  /**
   * Checks whether any tenant role grants a feature.
   *
   * This supports non-user runtimes such as scheduler workers that execute with
   * tenant scope but without an authenticated user.
   */
  async tenantHasFeature(
    tenantId: string | null | undefined,
    feature: string,
    opts?: { organizationId?: string | null },
  ): Promise<boolean> {
    if (!tenantId || !feature) return false

    const em = this.em.fork()
    const roleOrganizationScope = await resolveRoleOrganizationScope(
      this.organizationHierarchyService,
      tenantId,
      opts?.organizationId,
    )
    const roleAcls = await em.find(RoleAcl, { tenantId, deletedAt: null } as FilterQuery<RoleAcl>, {})
    const list = Array.isArray(roleAcls) ? roleAcls : []

    for (const acl of list) {
      if (!roleAclAllowsOrganization(acl, roleOrganizationScope)) continue
      const grants = Array.isArray(acl.featuresJson) ? acl.featuresJson : []
      if (authorizeFeatures([feature], {
        grantedFeatures: grants,
        unrestricted: acl.isSuperAdmin,
      })) {
        return true
      }
    }

    return false
  }

  /**
   * Checks if a user has all required features within a given scope.
   *
   * This is the primary authorization check method used throughout the application.
   * It combines feature checking with organization visibility validation.
   *
   * Authorization logic:
   * 1. No features required → always returns true
   * 2. User is super admin → always returns true
   * 3. Organization restriction check: If the user's ACL has a restricted organization list
   *    and the requested organization is not in that list → returns false
   * 4. Feature matching: User must have all required features (supports wildcards)
   *
   * @param userId - The ID of the user
   * @param required - Array of feature strings to check (e.g., ['users.view', 'users.edit'])
   * @param scope - The tenant and organization context for authorization
   * @returns true if the user has all required features and organization access, false otherwise
   *
   * @example
   * // Check if user can view and edit users
   * const canManageUsers = await rbacService.userHasAllFeatures(
   *   'user-123',
   *   ['users.view', 'users.edit'],
   *   { tenantId: 'tenant-1', organizationId: 'org-1' }
   * )
   *
   * @example
   * // Check with wildcard features
   * const canAccessEntities = await rbacService.userHasAllFeatures(
   *   'user-123',
   *   ['entities.records.view'],
   *   { tenantId: 'tenant-1', organizationId: 'org-1' }
   * )
   * // Returns true if user has 'entities.*', '*', or 'entities.records.view'
   */
  async userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }): Promise<boolean> {
    if (!required.length) return true
    const acl = await this.loadAcl(userId, scope)
    const organizationAllowed = acl.isSuperAdmin
      || !acl.organizations
      || !scope.organizationId
      || acl.organizations.includes(scope.organizationId)
      || acl.organizations.includes('__all__')
    return authorizeFeatures(required, {
      grantedFeatures: acl.features,
      unrestricted: acl.isSuperAdmin,
      scopeAllowed: organizationAllowed,
    })
  }

  /**
   * Returns the user's infrastructure grant list, filtered to enabled modules.
   * The result may contain wildcards; authoritative checks must still go through
   * `authorizeFeatures` or `userHasAllFeatures` so null overrides are enforced.
   */
  async getGrantedFeatures(
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<string[]> {
    const acl = await this.loadAcl(userId, scope)
    if (acl.isSuperAdmin) return filterGrantsByEnabledModules(['*'])
    if (
      acl.organizations &&
      scope.organizationId &&
      !acl.organizations.includes(scope.organizationId) &&
      !acl.organizations.includes('__all__')
    ) {
      return []
    }
    return filterGrantsByEnabledModules(acl.features)
  }

  /** Returns concrete active feature IDs for browser capability payloads. */
  async getEffectiveFeatures(
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<string[]> {
    const acl = await this.loadAcl(userId, scope)
    const organizationAllowed = acl.isSuperAdmin
      || !acl.organizations
      || !scope.organizationId
      || acl.organizations.includes(scope.organizationId)
      || acl.organizations.includes('__all__')
    if (!organizationAllowed) return []
    return resolveEffectiveFeatures(acl.isSuperAdmin ? ['*'] : acl.features)
  }
}
