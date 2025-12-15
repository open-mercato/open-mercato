import { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User, Role, UserRole, Session, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import crypto from 'node:crypto'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'

export class AuthService {
  constructor(private em: EntityManager) {}

  async findUserByEmail(email: string) {
    const emailHash = computeEmailHash(email)
    return this.em.findOne(User, {
      $or: [
        { email },
        { emailHash },
      ],
    } as any)
  }

  async verifyPassword(user: User, password: string) {
    if (!user.passwordHash) return false
    return compare(password, user.passwordHash)
  }

  async updateLastLoginAt(user: User) {
    const now = new Date()
    // Use native update to avoid flushing unrelated entities that might be pending in this EM
    await this.em.nativeUpdate(User, { id: user.id }, { lastLoginAt: now })
    user.lastLoginAt = now
  }

  async getUserRoles(user: User, tenantId?: string | null): Promise<string[]> {
    const resolvedTenantId = tenantId ?? user.tenantId ?? null
    if (!resolvedTenantId) return []
    const links = await this.em.find(
      UserRole,
      { user, role: { tenantId: resolvedTenantId } as any },
      { populate: ['role'] },
    )
    return links.map((l) => l.role.name)
  }


  async createSession(user: User, expiresAt: Date): Promise<Session> {
    const token = crypto.randomBytes(32).toString('hex')
    const sess = this.em.create(Session as any, { user, token, expiresAt, createdAt: new Date() } as any)
    await this.em.persistAndFlush(sess)
    return sess as Session
  }

  async deleteSessionByToken(token: string) {
    await this.em.nativeDelete(Session, { token })
  }

  async refreshFromSessionToken(token: string) {
    const now = new Date()
    const sess = await this.em.findOne(Session, { token })
    if (!sess || sess.expiresAt <= now) return null
    const user = await this.em.findOne(User, { id: sess.user.id })
    if (!user) return null
    const roles = await this.getUserRoles(user, user.tenantId ?? null)
    return { user, roles }
  }

  async requestPasswordReset(email: string) {
    const user = await this.findUserByEmail(email)
    if (!user) return null
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    const row = this.em.create(PasswordReset as any, { user, token, expiresAt, createdAt: new Date() } as any)
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
