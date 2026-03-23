import { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  CustomerUserAcl,
  CustomerRoleAcl,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

interface CustomerAclData {
  isPortalAdmin: boolean
  features: string[]
}

function isCustomerAclData(value: unknown): value is CustomerAclData {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<CustomerAclData>
  if (typeof record.isPortalAdmin !== 'boolean') return false
  if (!Array.isArray(record.features) || record.features.some((f) => typeof f !== 'string')) return false
  return true
}

export class CustomerRbacService {
  private cacheTtlMs: number = 5 * 60 * 1000
  private cache: CacheStrategy | null = null

  constructor(private em: EntityManager, cache?: CacheStrategy) {
    this.cache = cache || null
  }

  private getCacheKey(userId: string, scope: { tenantId: string; organizationId: string }): string {
    return `customer_rbac:${userId}:${scope.tenantId}:${scope.organizationId}`
  }

  private getUserTag(userId: string): string {
    return `customer_rbac:user:${userId}`
  }

  private getTenantTag(tenantId: string): string {
    return `customer_rbac:tenant:${tenantId}`
  }

  private async getFromCache(cacheKey: string): Promise<CustomerAclData | null> {
    if (!this.cache) return null
    const cached = await this.cache.get(cacheKey)
    if (!cached) return null
    return isCustomerAclData(cached) ? cached : null
  }

  private async setCache(
    cacheKey: string,
    data: CustomerAclData,
    userId: string,
    scope: { tenantId: string; organizationId: string },
  ): Promise<void> {
    if (!this.cache) return
    const tags = [
      this.getUserTag(userId),
      this.getTenantTag(scope.tenantId),
      'customer_rbac:all',
    ]
    await this.cache.set(cacheKey, data, { ttl: this.cacheTtlMs, tags })
  }

  async loadAcl(
    userId: string,
    scope: { tenantId: string; organizationId: string },
  ): Promise<CustomerAclData> {
    const cacheKey = this.getCacheKey(userId, scope)
    const cached = await this.getFromCache(cacheKey)
    if (cached) return cached

    const em = this.em.fork()

    // Per-user ACL first
    const userAcl = await em.findOne(CustomerUserAcl, {
      user: userId as any,
      tenantId: scope.tenantId,
    })
    if (userAcl) {
      const result: CustomerAclData = {
        isPortalAdmin: !!userAcl.isPortalAdmin,
        features: Array.isArray(userAcl.featuresJson) ? userAcl.featuresJson : [],
      }
      await this.setCache(cacheKey, result, userId, scope)
      return result
    }

    // Aggregate role ACLs
    const links = await em.find(CustomerUserRole, {
      user: userId as any,
      deletedAt: null,
    }, { populate: ['role'] })
    const roleIds = links.map((l) => (l.role as any)?.id).filter(Boolean)

    let isPortalAdmin = false
    const features: string[] = []
    if (roleIds.length) {
      const roleAcls = await em.find(CustomerRoleAcl, {
        tenantId: scope.tenantId,
        role: { $in: roleIds as any },
      } as any)
      for (const acl of roleAcls) {
        isPortalAdmin = isPortalAdmin || !!acl.isPortalAdmin
        if (Array.isArray(acl.featuresJson)) {
          for (const f of acl.featuresJson) {
            if (!features.includes(f)) features.push(f)
          }
        }
      }
    }

    const result: CustomerAclData = { isPortalAdmin, features }
    await this.setCache(cacheKey, result, userId, scope)
    return result
  }

  async userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string; organizationId: string },
  ): Promise<boolean> {
    if (!required.length) return true
    const acl = await this.loadAcl(userId, scope)
    if (acl.isPortalAdmin) return true
    return hasAllFeatures(required, acl.features)
  }

  async invalidateUserCache(userId: string): Promise<void> {
    if (!this.cache) return
    await this.cache.deleteByTags([this.getUserTag(userId)])
  }

  async invalidateRoleCache(roleId: string): Promise<void> {
    if (!this.cache) return
    // When a role changes, invalidate all customer RBAC caches since we don't track role→user mappings
    await this.cache.deleteByTags(['customer_rbac:all'])
  }

  async invalidateTenantCache(tenantId: string): Promise<void> {
    if (!this.cache) return
    await this.cache.deleteByTags([this.getTenantTag(tenantId)])
  }
}
