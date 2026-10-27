import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import { UserAcl, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

async function resolveRoleOrganizationScopeWithEntityManager(
  em: EntityManager,
  tenantId: string | null,
  organizationId: string | null,
): Promise<ReadonlySet<string> | null> {
  if (!organizationId) return null
  if (!tenantId) return new Set()
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: organizationId, tenant: tenantId, deletedAt: null } as FilterQuery<Organization>,
    { fields: ['id', 'ancestorIds'] },
    { tenantId, organizationId },
  )
  if (!organization) return new Set()
  const ancestors = Array.isArray(organization.ancestorIds)
    ? organization.ancestorIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  return new Set([organizationId, ...ancestors])
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

type FeatureOrganizationCandidate = {
  id: string
  ancestorIds?: readonly string[] | null
}

type FeatureOrganizationAccess = {
  unrestricted: boolean
  filterOrganizationIds: (organizations: readonly FeatureOrganizationCandidate[]) => string[]
}

type FeatureOrganizationRoleGrant = {
  isSuperAdmin: boolean
  featuresJson: string[] | null
  organizationsJson: string[] | null
}

type FeatureOrganizationGrants =
  | { kind: 'none' }
  | { kind: 'api_key'; organizationId: string | null; roleGrants: FeatureOrganizationRoleGrant[] }
  | { kind: 'user_acl'; isSuperAdmin: boolean; features: string[]; organizations: string[] | null }
  | { kind: 'roles'; roleGrants: FeatureOrganizationRoleGrant[] }

function isStringListOrNull(value: unknown): value is string[] | null {
  return value === null || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
}

function isFeatureOrganizationRoleGrant(value: unknown): value is FeatureOrganizationRoleGrant {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<FeatureOrganizationRoleGrant>
  return typeof record.isSuperAdmin === 'boolean'
    && isStringListOrNull(record.featuresJson)
    && isStringListOrNull(record.organizationsJson)
}

function isFeatureOrganizationGrants(value: unknown): value is FeatureOrganizationGrants {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  switch (record.kind) {
    case 'none':
      return true
    case 'api_key':
      return (record.organizationId === null || typeof record.organizationId === 'string')
        && Array.isArray(record.roleGrants)
        && record.roleGrants.every(isFeatureOrganizationRoleGrant)
    case 'user_acl':
      return typeof record.isSuperAdmin === 'boolean'
        && Array.isArray(record.features)
        && record.features.every((feature) => typeof feature === 'string')
        && isStringListOrNull(record.organizations)
    case 'roles':
      return Array.isArray(record.roleGrants) && record.roleGrants.every(isFeatureOrganizationRoleGrant)
    default:
      return false
  }
}

function toFeatureOrganizationRoleGrant(
  acl: Pick<RoleAcl, 'isSuperAdmin' | 'featuresJson' | 'organizationsJson'>,
): FeatureOrganizationRoleGrant {
  return {
    isSuperAdmin: acl.isSuperAdmin === true,
    featuresJson: Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : null,
    organizationsJson: Array.isArray(acl.organizationsJson) ? [...acl.organizationsJson] : null,
  }
}

function normalizeFeatureOrganizationCandidates(
  organizations: readonly FeatureOrganizationCandidate[],
): FeatureOrganizationCandidate[] {
  const normalized = new Map<string, FeatureOrganizationCandidate>()
  for (const organization of organizations) {
    const id = typeof organization.id === 'string' ? organization.id.trim() : ''
    if (!id || normalized.has(id)) continue
    const ancestorIds = Array.isArray(organization.ancestorIds)
      ? Array.from(new Set(organization.ancestorIds
        .map((ancestorId) => typeof ancestorId === 'string' ? ancestorId.trim() : '')
        .filter(Boolean)))
      : []
    normalized.set(id, { id, ancestorIds })
  }
  return Array.from(normalized.values())
}

function buildFeatureOrganizationScope(
  organization: FeatureOrganizationCandidate,
): ReadonlySet<string> {
  return new Set([organization.id, ...(organization.ancestorIds ?? [])])
}

function roleAclProvidesGlobalFeatureScope(acl: Pick<RoleAcl, 'organizationsJson'>): boolean {
  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  return !organizations || organizations.length === 0 || organizations.includes('__all__')
}

function roleAclProvidesGlobalVisibility(
  acl: Pick<RoleAcl, 'organizationsJson'>,
  emptyOrganizationsAreUnrestricted: boolean,
): boolean {
  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  if (!organizations || organizations.includes('__all__')) return true
  return emptyOrganizationsAreUnrestricted && organizations.length === 0
}

function roleAclProvidesOrganizationVisibility(
  acl: Pick<RoleAcl, 'organizationsJson'>,
  organizationScope: ReadonlySet<string>,
  emptyOrganizationsAreUnrestricted: boolean,
): boolean {
  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  if (!organizations || organizations.includes('__all__')) return true
  if (organizations.length === 0) return emptyOrganizationsAreUnrestricted
  return organizations.some((organizationId) => organizationScope.has(organizationId))
}

function roleAclsAuthorizeFeatures(
  roleAcls: readonly FeatureOrganizationRoleGrant[],
  required: readonly string[],
  organization: FeatureOrganizationCandidate,
  emptyOrganizationsAreUnrestricted: boolean,
): boolean {
  const organizationScope = buildFeatureOrganizationScope(organization)
  const grantedFeatures = new Set<string>()
  let unrestricted = false
  let scopeAllowed = false

  for (const acl of roleAcls) {
    if (roleAclProvidesOrganizationVisibility(acl, organizationScope, emptyOrganizationsAreUnrestricted)) {
      scopeAllowed = true
    }
    if (!roleAclAllowsOrganization(acl, organizationScope)) continue
    unrestricted = unrestricted || acl.isSuperAdmin === true
    for (const feature of Array.isArray(acl.featuresJson) ? acl.featuresJson : []) {
      grantedFeatures.add(feature)
    }
  }

  return authorizeFeatures([...required], {
    grantedFeatures: Array.from(grantedFeatures),
    unrestricted,
    scopeAllowed: scopeAllowed || unrestricted,
  })
}

function roleAclsAuthorizeFeaturesGlobally(
  roleAcls: readonly FeatureOrganizationRoleGrant[],
  required: readonly string[],
  emptyOrganizationsAreUnrestricted: boolean,
): boolean {
  const grantedFeatures = new Set<string>()
  let unrestricted = false
  let scopeAllowed = false

  for (const acl of roleAcls) {
    if (roleAclProvidesGlobalVisibility(acl, emptyOrganizationsAreUnrestricted)) {
      scopeAllowed = true
    }
    if (!roleAclProvidesGlobalFeatureScope(acl)) continue
    unrestricted = unrestricted || acl.isSuperAdmin === true
    for (const feature of Array.isArray(acl.featuresJson) ? acl.featuresJson : []) {
      grantedFeatures.add(feature)
    }
  }

  return authorizeFeatures([...required], {
    grantedFeatures: Array.from(grantedFeatures),
    unrestricted,
    scopeAllowed: scopeAllowed || unrestricted,
  })
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

    await this.cache.set(cacheKey, data, {
      ttl: this.cacheTtlMs,
      tags: this.buildCacheTags(userId, scope),
    })
  }

  private buildCacheTags(userId: string, scope: { tenantId: string | null; organizationId: string | null }): string[] {
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

    return tags
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

  private async isGlobalSuperAdmin(userId: string): Promise<boolean> {
    if (this.globalSuperAdminCache.has(userId)) return this.globalSuperAdminCache.get(userId)!
    const em = this.em.fork()
    const userSuper = await em.findOne(UserAcl, { user: userId as any, isSuperAdmin: true })
    if (userSuper && (userSuper as any).isSuperAdmin) {
      this.globalSuperAdminCache.set(userId, true)
      return true
    }
    const links = await findWithDecryption(
      em,
      UserRole,
      { user: userId as any },
      { populate: ['role'] },
      { tenantId: null, organizationId: null },
    )
    const linkList = Array.isArray(links) ? links : []
    if (!linkList.length) {
      this.globalSuperAdminCache.set(userId, false)
      return false
    }
    const roleIds = Array.from(new Set(linkList.map((link) => {
      const role = link.role as any
      return role?.id ? String(role.id) : null
    }).filter((id): id is string => typeof id === 'string' && id.length > 0)))
    if (!roleIds.length) {
      this.globalSuperAdminCache.set(userId, false)
      return false
    }
    const roleSupers = await em.find(RoleAcl, { isSuperAdmin: true, role: { $in: roleIds as any } } as any)
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

    // Direct user-level super-admin grants and unrestricted role-level
    // super-admin grants are global. Organization-restricted role grants are
    // deliberately excluded by isGlobalSuperAdmin and continue through the
    // scoped ACL projection below.
    if (!userId.startsWith('api_key:')) {
      if (await this.isGlobalSuperAdmin(userId)) {
        const result = { isSuperAdmin: true, features: ['*'], organizations: null }
        await this.setCache(cacheKey, result, userId, scope)
        return result
      }
    }

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
        const racls = await em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any)
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
    const tenantId = scope.tenantId || user.tenantId || null
    const orgId = scope.organizationId || user.organizationId || null

    if (!tenantId) {
      const result = { isSuperAdmin: false, features: [], organizations: null }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Per-user ACL first
    const uacl = await em.findOne(UserAcl, { user: userId as any, tenantId })
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
      { user: userId as any, role: { tenantId } } as any,
      { populate: ['role'] },
      { tenantId, organizationId: orgId },
    )
    const linkList = Array.isArray(links) ? links : []
    const roleIds = linkList.map((l) => (l.role as any)?.id).filter(Boolean)
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
      const racls = await em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any, {})
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
   * Cache-bypassing ACL resolution bound to a caller-supplied EntityManager.
   * Replay authorization uses this additive seam after taking its canonical
   * locks so every user, membership, role, ACL, API-key, and organization-scope
   * read observes the exact transaction that performs the mutation.
   */
  async loadAclWithEntityManager(
    em: EntityManager,
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<AclData> {
    if (userId.startsWith('api_key:')) {
      const key = await em.findOne(ApiKey, {
        id: userId.slice('api_key:'.length),
        deletedAt: null,
      })
      if (!key || (key.expiresAt && key.expiresAt.getTime() < Date.now())) {
        return { isSuperAdmin: false, features: [], organizations: null }
      }
      const tenantId = scope.tenantId || key.tenantId || null
      const roleIds = Array.isArray(key.rolesJson) ? key.rolesJson.filter(Boolean) : []
      const keyOrganizationId = typeof key.organizationId === 'string' && key.organizationId.trim().length > 0
        ? key.organizationId.trim()
        : null
      const evaluatedOrganizationId = scope.organizationId || keyOrganizationId
      const roleScope = await resolveRoleOrganizationScopeWithEntityManager(
        em,
        tenantId,
        evaluatedOrganizationId,
      )
      const roleAcls = tenantId && roleIds.length
        ? await em.find(RoleAcl, { tenantId, role: { $in: roleIds as never } } as never)
        : []
      let isSuperAdmin = false
      const features: string[] = []
      let organizations: string[] | null = []
      let hasApplicableRestrictedRole = false
      for (const acl of roleAcls) {
        if (roleAclAllowsOrganization(acl, roleScope)) {
          isSuperAdmin = isSuperAdmin || acl.isSuperAdmin === true
          for (const feature of Array.isArray(acl.featuresJson) ? acl.featuresJson : []) {
            if (!features.includes(feature)) features.push(feature)
          }
          if (isRestrictedRoleAcl(acl)) hasApplicableRestrictedRole = true
        }
        if (organizations !== null) {
          if (
            acl.organizationsJson == null
            || acl.organizationsJson.length === 0
            || acl.organizationsJson.includes('__all__')
          ) {
            organizations = null
          } else {
            organizations = Array.from(new Set([...organizations, ...acl.organizationsJson]))
          }
        }
      }
      if (
        organizations !== null
        && evaluatedOrganizationId
        && roleScope !== null
        && roleScope.size > 0
        && hasApplicableRestrictedRole
        && !organizations.includes(evaluatedOrganizationId)
      ) {
        organizations.push(evaluatedOrganizationId)
      }
      if (keyOrganizationId) {
        const keyScope = await resolveRoleOrganizationScopeWithEntityManager(em, tenantId, keyOrganizationId)
        organizations = organizations === null
          || organizations.some((organizationId) => keyScope?.has(organizationId))
          ? [keyOrganizationId]
          : []
      }
      if (isSuperAdmin && organizations !== null && !features.includes('*')) features.push('*')
      return { isSuperAdmin: isSuperAdmin && organizations === null, features, organizations }
    }

    const directGlobalGrant = await em.findOne(
      UserAcl,
      { user: userId as never, isSuperAdmin: true } as never,
    )
    if (directGlobalGrant?.isSuperAdmin) {
      return { isSuperAdmin: true, features: ['*'], organizations: null }
    }
    const globalLinks = await findWithDecryption(
      em,
      UserRole,
      { user: userId as never },
      { populate: ['role'] },
      { tenantId: null, organizationId: null },
    )
    const globalRoleIds = globalLinks
      .map((link) => typeof link.role === 'string' ? link.role : link.role?.id ? String(link.role.id) : null)
      .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
    if (globalRoleIds.length) {
      const globalRoleGrants = await em.find(
        RoleAcl,
        {
          role: { $in: globalRoleIds as never },
          isSuperAdmin: true,
        } as never,
      )
      if (globalRoleGrants.some((grant) => grant.isSuperAdmin && !isRestrictedRoleAcl(grant))) {
        return { isSuperAdmin: true, features: ['*'], organizations: null }
      }
    }

    const user = await em.findOne(User, { id: userId })
    if (!user) return { isSuperAdmin: false, features: [], organizations: null }
    const tenantId = scope.tenantId || user.tenantId || null
    const organizationId = scope.organizationId || user.organizationId || null
    if (!tenantId) return { isSuperAdmin: false, features: [], organizations: null }

    const userAcl = await em.findOne(UserAcl, { user: userId as never, tenantId } as never)
    if (userAcl) {
      return {
        isSuperAdmin: userAcl.isSuperAdmin === true,
        features: Array.isArray(userAcl.featuresJson) ? [...userAcl.featuresJson] : [],
        organizations: Array.isArray(userAcl.organizationsJson) ? [...userAcl.organizationsJson] : null,
      }
    }

    const links = await findWithDecryption(
      em,
      UserRole,
      { user: userId as never, role: { tenantId } } as never,
      { populate: ['role'] },
      { tenantId, organizationId },
    )
    const roleIds = links
      .map((link) => typeof link.role === 'string' ? link.role : link.role?.id ? String(link.role.id) : null)
      .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
    const roleAcls = roleIds.length
      ? await em.find(RoleAcl, { tenantId, role: { $in: roleIds as never } } as never)
      : []
    const roleScope = await resolveRoleOrganizationScopeWithEntityManager(
      em,
      tenantId,
      scope.organizationId,
    )
    let isSuperAdmin = false
    const features: string[] = []
    let organizations: string[] | null = []
    let hasApplicableRestrictedRole = false
    for (const acl of roleAcls) {
      if (roleAclAllowsOrganization(acl, roleScope)) {
        isSuperAdmin = isSuperAdmin || acl.isSuperAdmin === true
        for (const feature of Array.isArray(acl.featuresJson) ? acl.featuresJson : []) {
          if (!features.includes(feature)) features.push(feature)
        }
        if (isRestrictedRoleAcl(acl)) hasApplicableRestrictedRole = true
      }
      if (organizations !== null) {
        if (acl.organizationsJson == null || acl.organizationsJson.includes('__all__')) {
          organizations = null
        } else {
          organizations = Array.from(new Set([...organizations, ...acl.organizationsJson]))
        }
      }
    }
    if (
      organizations !== null
      && scope.organizationId
      && roleScope
      && roleScope.size > 0
      && hasApplicableRestrictedRole
      && !organizations.includes(scope.organizationId)
    ) {
      organizations.push(scope.organizationId)
    }
    return { isSuperAdmin, features, organizations }
  }

  async userHasAllFeaturesWithEntityManager(
    em: EntityManager,
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean> {
    if (!required.length) return true
    const acl = await this.loadAclWithEntityManager(em, userId, scope)
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

  async getGrantedFeaturesWithEntityManager(
    em: EntityManager,
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<string[]> {
    const acl = await this.loadAclWithEntityManager(em, userId, scope)
    if (acl.isSuperAdmin) return filterGrantsByEnabledModules(['*'])
    if (
      acl.organizations
      && scope.organizationId
      && !acl.organizations.includes(scope.organizationId)
      && !acl.organizations.includes('__all__')
    ) {
      return []
    }
    return filterGrantsByEnabledModules(acl.features)
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
    const roleAcls = await em.find(RoleAcl, { tenantId, deletedAt: null } as any, {})
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

  async resolveFeatureOrganizationAccess(
    userId: string,
    required: readonly string[],
    input: { tenantId: string | null },
  ): Promise<FeatureOrganizationAccess> {
    const allowAll = (organizations: readonly FeatureOrganizationCandidate[]) =>
      normalizeFeatureOrganizationCandidates(organizations).map((organization) => organization.id)
    const denyAll = () => []
    if (!required.length) return { unrestricted: true, filterOrganizationIds: allowAll }
    if (!input.tenantId) return { unrestricted: false, filterOrganizationIds: denyAll }
    if (
      !userId.startsWith('api_key:')
      && await this.isGlobalSuperAdmin(userId)
      && authorizeFeatures(required, { grantedFeatures: ['*'], unrestricted: true })
    ) {
      return { unrestricted: true, filterOrganizationIds: allowAll }
    }

    const grants = await this.loadFeatureOrganizationGrants(userId, input.tenantId)
    if (grants.kind === 'none') return { unrestricted: false, filterOrganizationIds: denyAll }

    if (grants.kind === 'api_key') {
      const keyOrganizationId = grants.organizationId
      const unrestricted = keyOrganizationId === null
        && roleAclsAuthorizeFeaturesGlobally(grants.roleGrants, required, true)
      if (unrestricted) return { unrestricted: true, filterOrganizationIds: allowAll }

      return {
        unrestricted: false,
        filterOrganizationIds: (candidates) => normalizeFeatureOrganizationCandidates(candidates)
          .filter((organization) => (
            (!keyOrganizationId || organization.id === keyOrganizationId)
            && roleAclsAuthorizeFeatures(grants.roleGrants, required, organization, true)
          ))
          .map((organization) => organization.id),
      }
    }

    if (grants.kind === 'user_acl') {
      const grantedFeatures = grants.features
      const allowedOrganizations = grants.organizations
      const hasGlobalScope = grants.isSuperAdmin
        || allowedOrganizations === null
        || allowedOrganizations.includes('__all__')
      const unrestricted = authorizeFeatures([...required], {
        grantedFeatures,
        unrestricted: grants.isSuperAdmin,
        scopeAllowed: hasGlobalScope,
      })
      if (unrestricted) return { unrestricted: true, filterOrganizationIds: allowAll }

      return {
        unrestricted: false,
        filterOrganizationIds: (candidates) => normalizeFeatureOrganizationCandidates(candidates)
          .filter((organization) => {
            const scopeAllowed = grants.isSuperAdmin
              || allowedOrganizations === null
              || allowedOrganizations.includes('__all__')
              || allowedOrganizations.includes(organization.id)
            return authorizeFeatures([...required], {
              grantedFeatures,
              unrestricted: grants.isSuperAdmin,
              scopeAllowed,
            })
          })
          .map((organization) => organization.id),
      }
    }

    if (roleAclsAuthorizeFeaturesGlobally(grants.roleGrants, required, false)) {
      return { unrestricted: true, filterOrganizationIds: allowAll }
    }

    return {
      unrestricted: false,
      filterOrganizationIds: (candidates) => normalizeFeatureOrganizationCandidates(candidates)
        .filter((organization) => roleAclsAuthorizeFeatures(grants.roleGrants, required, organization, false))
        .map((organization) => organization.id),
    }
  }

  private async loadFeatureOrganizationGrants(
    userId: string,
    tenantId: string,
  ): Promise<FeatureOrganizationGrants> {
    const cacheKey = `rbac:feature-organizations:${userId}:${tenantId}`
    if (this.cache) {
      const cached = await this.cache.get(cacheKey)
      if (isFeatureOrganizationGrants(cached)) return cached
    }
    const grants = await this.queryFeatureOrganizationGrants(userId, tenantId)
    if (this.cache) {
      await this.cache.set(cacheKey, grants, {
        ttl: this.cacheTtlMs,
        tags: this.buildCacheTags(userId, { tenantId, organizationId: null }),
      })
    }
    return grants
  }

  private async queryFeatureOrganizationGrants(
    userId: string,
    tenantId: string,
  ): Promise<FeatureOrganizationGrants> {
    const em = this.em.fork()
    if (userId.startsWith('api_key:')) {
      const apiKeyId = userId.slice('api_key:'.length)
      const key = await em.findOne(ApiKey, { id: apiKeyId, deletedAt: null })
      if (
        !key
        || (key.expiresAt && key.expiresAt.getTime() < Date.now())
        || (key.tenantId && key.tenantId !== tenantId)
      ) {
        return { kind: 'none' }
      }

      const roleIds = Array.isArray(key.rolesJson) ? key.rolesJson.filter(Boolean) : []
      if (!roleIds.length) return { kind: 'none' }
      const roleAcls = await em.find(RoleAcl, {
        tenantId,
        role: { $in: roleIds },
      })
      const keyOrganizationId = typeof key.organizationId === 'string' && key.organizationId.trim().length > 0
        ? key.organizationId.trim()
        : null
      return {
        kind: 'api_key',
        organizationId: keyOrganizationId,
        roleGrants: roleAcls.map(toFeatureOrganizationRoleGrant),
      }
    }

    const user = await em.findOne(User, { id: userId })
    if (!user) return { kind: 'none' }

    const userAcl = await em.findOne(UserAcl, { user: userId, tenantId })
    if (userAcl) {
      return {
        kind: 'user_acl',
        isSuperAdmin: userAcl.isSuperAdmin === true,
        features: Array.isArray(userAcl.featuresJson) ? [...userAcl.featuresJson] : [],
        organizations: Array.isArray(userAcl.organizationsJson) ? [...userAcl.organizationsJson] : null,
      }
    }

    const links = await findWithDecryption(
      em,
      UserRole,
      { user: userId, role: { tenantId } },
      { populate: ['role'] },
      { tenantId, organizationId: null },
    )
    const roleIds = Array.from(new Set(links
      .map((link) => link.role?.id)
      .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)))
    if (!roleIds.length) return { kind: 'none' }

    const roleAcls = await em.find(RoleAcl, {
      tenantId,
      role: { $in: roleIds },
    })
    return { kind: 'roles', roleGrants: roleAcls.map(toFeatureOrganizationRoleGrant) }
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
