import type { EntityManager } from '@mikro-orm/postgresql'
import { UserAcl, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'

export class RbacService {
  constructor(private em: EntityManager) {}

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

  async loadAcl(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<{
    isSuperAdmin: boolean
    features: string[]
    organizations: string[] | null
  }> {
    // Use a forked EntityManager to avoid inheriting an aborted transaction from callers
    const em = this.em.fork()
    const user = await em.findOne(User, { id: userId })
    if (!user) return { isSuperAdmin: false, features: [], organizations: null }
    const tenantId = scope.tenantId || user.tenantId || null
    const orgId = scope.organizationId || user.organizationId || null

    // Per-user ACL first
    const uacl = tenantId ? await em.findOne(UserAcl, { user: userId as any, tenantId }) : null
    if (uacl) {
      return {
        isSuperAdmin: !!uacl.isSuperAdmin,
        features: Array.isArray(uacl.featuresJson) ? (uacl.featuresJson as string[]) : [],
        organizations: Array.isArray(uacl.organizationsJson) ? (uacl.organizationsJson as string[]) : null,
      }
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
    return { isSuperAdmin: isSuper, features, organizations }
  }

  async userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }): Promise<boolean> {
    if (!required.length) return true
    const acl = await this.loadAcl(userId, scope)
    if (acl.isSuperAdmin) return true
    if (acl.organizations && scope.organizationId && !acl.organizations.includes(scope.organizationId)) return false
    return this.hasAllFeatures(required, acl.features)
  }
}


