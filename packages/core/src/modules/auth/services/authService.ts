import { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User, Role, UserRole, Session, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { generateAuthToken, hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// A fixed, valid bcrypt hash (cost 10) of a throwaway value no real password
// can match. verifyPassword compares against it whenever the user is missing or
// has no password hash, so a failed login spends the same bcrypt CPU time
// regardless of whether the account exists — closing the timing side channel
// for account enumeration (issue #2242).
const TIMING_EQUALIZER_PASSWORD_HASH = '$2b$10$OcZrhmZpIzJOjkfwUrk7d.Nl0eHNzOvalBcBlt5Ran.4lj8R3HZg6'

export class AuthService {
  constructor(private em: EntityManager) {}

  async findUserByEmail(email: string) {
    const emailHashes = emailHashLookupValues(email)
    return findOneWithDecryption(this.em, User, {
      deletedAt: null,
      $or: [
        { email },
        { emailHash: { $in: emailHashes } },
      ],
    } as any)
  }

  async findUsersByEmail(email: string) {
    const emailHashes = emailHashLookupValues(email)
    return findWithDecryption(this.em, User, {
      deletedAt: null,
      $or: [
        { email },
        { emailHash: { $in: emailHashes } },
      ],
    } as any)
  }

  async findUserByEmailAndTenant(email: string, tenantId: string) {
    const emailHashes = emailHashLookupValues(email)
    return findOneWithDecryption(
      this.em,
      User,
      {
        tenantId,
        deletedAt: null,
        $or: [
          { email },
          { emailHash: { $in: emailHashes } },
        ],
      } as any,
      undefined,
      { tenantId },
    )
  }

  async verifyPassword(user: User | null, password: string) {
    const storedHash = user?.passwordHash ?? null
    // Always run a bcrypt comparison — against a fixed dummy hash when the user
    // is absent or has no password — so login latency does not reveal whether
    // the account exists (timing-based enumeration, issue #2242).
    const matched = await compare(password, storedHash ?? TIMING_EQUALIZER_PASSWORD_HASH)
    return storedHash !== null && matched
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
    const links = await findWithDecryption(
      this.em,
      UserRole,
      { user, deletedAt: null, role: { tenantId: resolvedTenantId, deletedAt: null } as any },
      { populate: ['role'] },
      { tenantId: resolvedTenantId, organizationId: user.organizationId ?? null },
    )
    return links.map((l) => l.role.name)
  }


  async createSession(user: User, expiresAt: Date): Promise<{ session: Session; token: string }> {
    const rawToken = generateAuthToken()
    const tokenHash = hashAuthToken(rawToken)
    const sess = this.em.create(Session as any, { user, token: tokenHash, expiresAt, createdAt: new Date() } as any)
    await this.em.persist(sess).flush()
    return { session: sess as Session, token: rawToken }
  }

  async deleteSessionByToken(token: string) {
    const hashedToken = hashAuthToken(token)
    await this.em.nativeDelete(Session, { token: hashedToken })
  }

  async deleteSessionById(sessionId: string) {
    await this.em.nativeDelete(Session, { id: sessionId })
  }

  async findActiveSessionById(sessionId: string): Promise<Session | null> {
    const session = await this.em.findOne(Session, { id: sessionId, deletedAt: null })
    if (!session) return null
    if (session.expiresAt.getTime() < Date.now()) return null
    return session
  }

  async deleteAllUserSessions(userId: string) {
    await this.em.nativeDelete(Session, { user: userId })
  }

  async refreshFromSessionToken(token: string) {
    const now = new Date()
    const hashedToken = hashAuthToken(token)
    const sess = await this.em.findOne(Session, { token: hashedToken })
    if (!sess || sess.expiresAt <= now) return null
    const user = await findOneWithDecryption(this.em, User, { id: sess.user.id, deletedAt: null })
    if (!user) return null
    const roles = await this.getUserRoles(user, user.tenantId ?? null)
    return { user, roles, session: sess }
  }

  async requestPasswordReset(email: string) {
    const user = await this.findUserByEmail(email)
    if (!user) return null
    const rawToken = generateAuthToken()
    const tokenHash = hashAuthToken(rawToken)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    const row = this.em.create(PasswordReset as any, { user, token: tokenHash, expiresAt, createdAt: new Date() } as any)
    await this.em.persist(row).flush()
    return { user, token: rawToken }
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<User | null> {
    const now = new Date()
    const hashedToken = hashAuthToken(token)
    const row = await this.em.findOne(PasswordReset, { token: hashedToken })
    if (!row || (row.usedAt && row.usedAt <= now) || row.expiresAt <= now) return null

    // Atomic compare-and-set: only mark used if still unused — prevents token replay under concurrency
    const affected = await this.em.nativeUpdate(
      PasswordReset,
      { id: row.id, usedAt: null },
      { usedAt: now },
    )
    if (affected === 0) return null

    const user = await findOneWithDecryption(this.em, User, { id: row.user.id, deletedAt: null })
    if (!user) return null
    user.passwordHash = await hash(newPassword, 10)
    await this.em.flush()
    await this.deleteAllUserSessions(String(user.id))
    return user
  }
}
