import type { EntityManager } from '@mikro-orm/postgresql'
import { UserAcl, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'

interface AclCacheEntry {
  data: {
    isSuperAdmin: boolean
    features: string[]
    organizations: string[] | null
  }
  expiresAt: number
}

export class RbacService {
  private aclCache: Map<string, AclCacheEntry> = new Map()
  private cacheTtlMs: number = 5 * 60 * 1000 // 5 minutes default

  constructor(private em: EntityManager, cacheTtlMs?: number) {
    if (cacheTtlMs !== undefined) {
      this.cacheTtlMs = cacheTtlMs
    }
  }

  /**
   * Checks if a required feature is satisfied by a granted feature permission.
   * 
   * Wildcard patterns:
   * - `*` (global wildcard): Grants access to all features
   * - `prefix.*` (module wildcard): Grants access to all features starting with `prefix.`
   *   and also the exact prefix itself (e.g., `entities.*` matches both `entities` and `entities.records.view`)
   * - Exact match: Feature must match exactly (e.g., `users.view` only matches `users.view`)
   * 
   * @param required - The feature being requested (e.g., 'entities.records.view')
   * @param granted - The feature permission granted (e.g., 'entities.*' or '*')
   * @returns true if the granted permission satisfies the required feature
   * 
   * @example
   * matchFeature('users.view', '*') // true - global wildcard
   * matchFeature('entities.records.view', 'entities.*') // true - module wildcard
   * matchFeature('entities', 'entities.*') // true - exact prefix match
   * matchFeature('users.view', 'entities.*') // false - different module
   * matchFeature('users.view', 'users.view') // true - exact match
   */
  private matchFeature(required: string, granted: string): boolean {
    if (granted === '*') return true
    if (granted.endsWith('.*')) {
      const prefix = granted.slice(0, -2)
      return required === prefix || required.startsWith(prefix + '.')
    }
    return granted === required
  }

  private hasAllFeatures(required: string[], granted: string[]): boolean {
    if (!required.length) return true
    if (!granted.length) return false
    return required.every((req) => granted.some((g) => this.matchFeature(req, g)))
  }

  private getCacheKey(userId: string, scope: { tenantId: string | null; organizationId: string | null }): string {
    return `${userId}:${scope.tenantId || 'null'}:${scope.organizationId || 'null'}`
  }

  private getFromCache(cacheKey: string): AclCacheEntry['data'] | null {
    const entry = this.aclCache.get(cacheKey)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.aclCache.delete(cacheKey)
      return null
    }
    return entry.data
  }

  private setCache(cacheKey: string, data: AclCacheEntry['data']): void {
    this.aclCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs
    })
  }

  /**
   * Invalidates cached ACL data for a specific user across all tenants and organizations.
   * Call this when a user's roles or user-specific ACL is modified.
   * 
   * @param userId - The ID of the user whose cache should be invalidated
   */
  invalidateUserCache(userId: string): void {
    for (const key of this.aclCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.aclCache.delete(key)
      }
    }
  }

  /**
   * Invalidates cached ACL data for all users within a specific tenant.
   * Call this when a role's ACL is modified, since roles are tenant-scoped
   * and affect all users in that tenant who have that role.
   * 
   * @param tenantId - The ID of the tenant whose cache should be invalidated
   */
  invalidateTenantCache(tenantId: string): void {
    for (const key of this.aclCache.keys()) {
      const parts = key.split(':')
      if (parts[1] === tenantId) {
        this.aclCache.delete(key)
      }
    }
  }

  /**
   * Invalidates cached ACL data for all users within a specific organization.
   * Call this when organization-level permissions or visibility changes.
   * 
   * @param organizationId - The ID of the organization whose cache should be invalidated
   */
  invalidateOrganizationCache(organizationId: string): void {
    for (const key of this.aclCache.keys()) {
      const parts = key.split(':')
      if (parts[2] === organizationId) {
        this.aclCache.delete(key)
      }
    }
  }

  /**
   * Clears all cached ACL data.
   * Use this for bulk operations or system-wide ACL changes.
   */
  invalidateAllCache(): void {
    this.aclCache.clear()
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
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    // Use a forked EntityManager to avoid inheriting an aborted transaction from callers
    const em = this.em.fork()
    const user = await em.findOne(User, { id: userId })
    if (!user) {
      const result = { isSuperAdmin: false, features: [], organizations: null }
      this.setCache(cacheKey, result)
      return result
    }
    const tenantId = scope.tenantId || user.tenantId || null
    const orgId = scope.organizationId || user.organizationId || null

    // Per-user ACL first
    const uacl = tenantId ? await em.findOne(UserAcl, { user: userId as any, tenantId }) : null
    if (uacl) {
      const result = {
        isSuperAdmin: !!uacl.isSuperAdmin,
        features: Array.isArray(uacl.featuresJson) ? (uacl.featuresJson as string[]) : [],
        organizations: Array.isArray(uacl.organizationsJson) ? (uacl.organizationsJson as string[]) : null,
      }
      this.setCache(cacheKey, result)
      return result
    }

    // Aggregate role ACLs
    const links = await em.find(UserRole, { user: userId as any }, { populate: ['role'] })
    const roleIds = links.map((l) => (l.role as any)?.id).filter(Boolean)
    let isSuper = false
    const features: string[] = []
    let organizations: string[] | null = []
    if (tenantId && roleIds.length) {
      const racls = await em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any, {})
      for (const r of racls) {
        isSuper = isSuper || !!r.isSuperAdmin
        if (Array.isArray(r.featuresJson)) for (const f of r.featuresJson) if (!features.includes(f)) features.push(f)
        if (organizations !== null) {
          if (r.organizationsJson == null) organizations = null
          else organizations = Array.from(new Set([...(organizations || []), ...r.organizationsJson]))
        }
      }
    }
    if (organizations && orgId && !organizations.includes(orgId)) {
      // Out-of-scope org; caller will enforce
    }
    const result = { isSuperAdmin: isSuper, features, organizations }
    this.setCache(cacheKey, result)
    return result
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
    if (acl.isSuperAdmin) return true
    if (acl.organizations && scope.organizationId && !acl.organizations.includes(scope.organizationId)) return false
    return this.hasAllFeatures(required, acl.features)
  }
}


