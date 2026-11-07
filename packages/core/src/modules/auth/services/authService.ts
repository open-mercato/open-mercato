import { EntityManager, type RequiredEntityData } from '@mikro-orm/postgresql'
import { getPasswordHasher } from '@open-mercato/shared/lib/auth/passwordHasher'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { User, Role, UserRole, Session, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { generateAuthToken, hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isStaffTenantActive } from '@open-mercato/core/modules/auth/lib/tenantEligibility'

const logger = createLogger('auth').child({ component: 'auth-service' })

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
    const hasher = getPasswordHasher()
    // Always run a password verification — a dummy one when the user is absent
    // or has no password — so login latency does not reveal whether the account
    // exists (timing-based enumeration, issue #2242).
    if (storedHash === null) {
      await hasher.equalizeTiming(password)
      return false
    }
    return hasher.verify(password, storedHash)
  }

  /**
   * After a successful login, replace a hash made with an outdated algorithm or
   * parameters (`OM_PASSWORD_HASH`) with a fresh one. Best effort: a failure is
   * logged and reported, never thrown, so it can not fail the login. The update
   * is a compare-and-swap on the old hash, so a concurrent password change wins,
   * and it leaves `updated_at` alone so it never causes an optimistic-lock 409.
   */
  async rehashPasswordIfNeeded(user: User, password: string): Promise<boolean> {
    const storedHash = user.passwordHash ?? null
    if (!storedHash) return false
    const hasher = getPasswordHasher()
    try {
      if (!hasher.needsRehash(storedHash)) return false
      const nextHash = await hasher.hash(password)
      const affected = await this.em.nativeUpdate(
        User,
        {
          id: user.id,
          tenantId: user.tenantId ?? null,
          organizationId: user.organizationId ?? null,
          passwordHash: storedHash,
        },
        { passwordHash: nextHash },
      )
      if (affected === 0) return false
      return true
    } catch (error) {
      logger.warn('Password rehash after login failed', { userId: String(user.id), err: error })
      getTelemetryRuntime()?.reportError(error, {
        module: 'auth',
        code: 'auth.password_rehash_failed',
        attributes: { userId: String(user.id) },
      })
      return false
    }
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
    // A populated `role` can still be null when the link points at a soft-deleted
    // role (the Role soft-delete filter suppresses hydration), e.g. an admin link
    // orphaned by a re-seed during interrupted-provisioning recovery. Dropping such
    // links keeps role resolution from throwing on the login / session-refresh hot
    // path, mirroring resolveCanonicalStaffAuthContext in lib/sessionIntegrity.ts.
    return links
      .map((l) => l.role)
      .filter((role): role is Role => !!role)
      .map((role) => role.name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
  }


  async createSession(user: User, expiresAt: Date): Promise<{ session: Session; token: string }> {
    return this.createSessionWithEntityManager(this.em, user, expiresAt)
  }

  protected async createSessionWithEntityManager(
    em: EntityManager,
    user: User,
    expiresAt: Date,
  ): Promise<{ session: Session; token: string }> {
    if (!(await isStaffTenantActive(em, user.tenantId))) {
      throw new Error('[internal] Tenant is not available for authentication')
    }
    const rawToken = generateAuthToken()
    const tokenHash = hashAuthToken(rawToken)
    const session = em.create(Session, { user, token: tokenHash, expiresAt, createdAt: new Date() } as RequiredEntityData<Session>)
    await em.persist(session).flush()
    return { session, token: rawToken }
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
    if (!(await isStaffTenantActive(this.em, user.tenantId))) return null
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

  private async findUnconsumedPasswordReset(token: string): Promise<PasswordReset | null> {
    const now = new Date()
    const hashedToken = hashAuthToken(token)
    const row = await this.em.findOne(PasswordReset, { token: hashedToken })
    if (!row) return null
    if (row.usedAt && row.usedAt <= now) return null
    if (row.expiresAt <= now) return null
    return row
  }

  async isPasswordResetTokenValid(token: string): Promise<boolean> {
    const row = await this.findUnconsumedPasswordReset(token)
    if (!row) return false
    const user = await findOneWithDecryption(this.em, User, { id: row.user.id, deletedAt: null })
    return user != null
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<User | null> {
    const now = new Date()
    const row = await this.findUnconsumedPasswordReset(token)
    if (!row) return null

    // Atomic compare-and-set: only mark used if still unused — prevents token replay under concurrency
    const affected = await this.em.nativeUpdate(
      PasswordReset,
      { id: row.id, usedAt: null },
      { usedAt: now },
    )
    if (affected === 0) return null

    const user = await findOneWithDecryption(this.em, User, { id: row.user.id, deletedAt: null })
    if (!user) return null
    user.passwordHash = await getPasswordHasher().hash(newPassword)
    await this.em.flush()
    await this.deleteAllUserSessions(String(user.id))
    return user
  }
}
