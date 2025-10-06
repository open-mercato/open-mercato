import { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User, Role, UserRole, Session, PasswordReset, UserAcl, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import crypto from 'node:crypto'

export class AuthService {
  constructor(private em: EntityManager) {}

  async findUserByEmail(email: string) {
    return this.em.findOne(User, { email })
  }

  async verifyPassword(user: User, password: string) {
    if (!user.passwordHash) return false
    return compare(password, user.passwordHash)
  }

  async updateLastLoginAt(user: User) {
    user.lastLoginAt = new Date()
    await this.em.flush()
  }

  async getUserRoles(user: User): Promise<string[]> {
    const links = await this.em.find(UserRole, { user }, { populate: ['role'] })
    return links.map(l => l.role.name)
  }

  // RBAC helpers
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

  async loadUserAcl(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<{
    isSuperAdmin: boolean
    features: string[]
    organizations: string[] | null
  }> {
    const user = await this.em.findOne(User, { id: userId })
    if (!user) return { isSuperAdmin: false, features: [], organizations: null }
    const tenantId = scope.tenantId || user.tenantId || null
    const orgId = scope.organizationId || user.organizationId || null

    // Per-user ACL first
    const uacl = tenantId ? await this.em.findOne(UserAcl, { user: userId as any, tenantId }) : null
    if (uacl) {
      return {
        isSuperAdmin: !!uacl.isSuperAdmin,
        features: Array.isArray(uacl.featuresJson) ? (uacl.featuresJson as string[]) : [],
        organizations: Array.isArray(uacl.organizationsJson) ? (uacl.organizationsJson as string[]) : null,
      }
    }

    // Aggregate role ACLs (OR semantics for features; superadmin if any role grants it). Org lists union; null means all orgs
    const links = await this.em.find(UserRole, { user: userId as any }, { populate: ['role'] })
    const roleIds = links.map((l) => (l.role as any)?.id).filter(Boolean)
    let isSuper = false
    const features: string[] = []
    let organizations: string[] | null = []
    if (tenantId && roleIds.length) {
      const racls = await this.em.find(RoleAcl, { tenantId, role: { $in: roleIds as any } } as any, {})
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
      // If org restriction present and current org not included, the checker will combine restrictions
    }
    return { isSuperAdmin: isSuper, features, organizations }
  }

  async userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }): Promise<boolean> {
    if (!required.length) return true
    const acl = await this.loadUserAcl(userId, scope)
    if (acl.isSuperAdmin) return true
    if (acl.organizations && scope.organizationId && !acl.organizations.includes(scope.organizationId)) return false
    return this.hasAllFeatures(required, acl.features)
  }

  async createSession(user: User, expiresAt: Date) {
    const token = crypto.randomBytes(32).toString('hex')
    const sess = this.em.create(Session, { user, token, expiresAt })
    await this.em.persistAndFlush(sess)
    return sess
  }

  async deleteSessionByToken(token: string) {
    await this.em.nativeDelete(Session, { token })
  }

  async refreshFromSessionToken(token: string) {
    const now = new Date()
    const sess = await this.em.findOne(Session, { token })
    if (!sess || sess.expiresAt <= now) return null
    const user = await this.em.findOne(User, { id: sess.user.id }, { populate: ['organization', 'tenant'] })
    if (!user) return null
    const roles = await this.getUserRoles(user)
    return { user, roles }
  }

  async requestPasswordReset(email: string) {
    const user = await this.findUserByEmail(email)
    if (!user) return null
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    const row = this.em.create(PasswordReset, { user, token, expiresAt })
    await this.em.persistAndFlush(row)
    return { user, token }
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    const now = new Date()
    const row = await this.em.findOne(PasswordReset, { token })
    if (!row || (row.usedAt && row.usedAt <= now) || row.expiresAt <= now) return false
    const user = await this.em.findOne(User, { id: row.user.id })
    if (!user) return false
    user.passwordHash = await hash(newPassword, 10)
    row.usedAt = new Date()
    await this.em.flush()
    return true
  }
}
