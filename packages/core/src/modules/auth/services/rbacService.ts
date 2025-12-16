import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import { UserAcl, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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

export class RbacService {
  private cacheTtlMs: number = 5 * 60 * 1000 // 5 minutes default
  private cache: CacheStrategy | null = null
  private globalSuperAdminCache = new Map<string, boolean>()

  constructor(private em: EntityManager, cache?: CacheStrategy) {
    this.cache = cache || null
  }

  /**
   * Set cache TTL in milliseconds
   * @param ttlMs - Time to live in milliseconds
   */
  setCacheTtl(ttlMs: number) {
    this.cacheTtlMs = ttlMs
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
    await this.deleteCacheByTags([this.getUserTag(userId)])
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
    await this.deleteCacheByTags([this.getTenantTag(tenantId)], [tenantId])
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
    const roleSuper = await em.findOne(RoleAcl, { isSuperAdmin: true, role: { $in: roleIds as any } } as any)
    const result = !!(roleSuper && (roleSuper as any).isSuperAdmin)
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
      let isSuper = false
      const features: string[] = []
      let organizations: string[] | null = key.organizationId ? [key.organizationId] : null
      if (tenantId && roleIds.length) {
        const racls = await em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any)
        for (const acl of racls) {
          isSuper = isSuper || !!acl.isSuperAdmin
          if (Array.isArray(acl.featuresJson)) {
            for (const f of acl.featuresJson) if (!features.includes(f)) features.push(f)
          }
          if (organizations !== null) {
            if (acl.organizationsJson == null) {
              organizations = null
            } else {
              organizations = Array.from(new Set([...(organizations || []), ...acl.organizationsJson]))
            }
          }
        }
      }
      const result = { isSuperAdmin: isSuper, features, organizations }
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
    if (roleIds.length) {
      const racls = await em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any, {})
      const roleAcls = Array.isArray(racls) ? racls : []
      for (const r of roleAcls) {
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
    await this.setCache(cacheKey, result, userId, scope)
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
