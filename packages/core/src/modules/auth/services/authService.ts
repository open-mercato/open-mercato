import { EntityManager, type RequiredEntityData } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { compare, hash } from 'bcryptjs'
import { User, Role, UserRole, Session, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { generateAuthToken, hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isStaffTenantActive } from '@open-mercato/core/modules/auth/lib/tenantEligibility'
import { AuthSessionRejectedError, matchesPasswordSessionProof, type PasswordSessionProof } from '../lib/sessionEligibility'
import { isWithinPasswordByteLimit } from '@open-mercato/shared/lib/auth/passwordPolicy'

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


  async createSession(user: User, expiresAt: Date, proof?: PasswordSessionProof): Promise<{ session: Session; token: string }> {
    if (!proof) return this.createSessionWithEntityManager(this.em, user, expiresAt)
    return this.em.transactional(async (txEm) => {
      const currentUser = await this.findLockedSessionUser(txEm, user)
      if (!currentUser || !matchesPasswordSessionProof(currentUser, proof)) throw new AuthSessionRejectedError()
      return this.createSessionWithEntityManager(txEm, currentUser, expiresAt)
    })
  }

  private async findLockedSessionUser(em: EntityManager, user: User): Promise<User | null> {
    const tenantId = user.tenantId ?? null
    const organizationId = user.organizationId ?? null
    return findOneWithDecryption(
      em, User,
      { id: user.id, tenantId, organizationId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { tenantId, organizationId },
    )
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
    const requestedEmail = user.email
    return this.em.transactional(async (txEm) => {
      const currentUser = await this.findLockedSessionUser(txEm, user)
      if (!currentUser || currentUser.email !== requestedEmail) return null
      const rawToken = generateAuthToken()
      const tokenHash = hashAuthToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      const row = txEm.create(PasswordReset, { user: currentUser, token: tokenHash, expiresAt, createdAt: new Date() })
      await txEm.persist(row).flush()
      return { user: currentUser, token: rawToken }
    })
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
    if (!isWithinPasswordByteLimit(newPassword)) return null
    const row = await this.findUnconsumedPasswordReset(token)
    if (!row) return null
    const passwordHash = await hash(newPassword, 10)
    const userId = String(row.user.id)
    return this.em.transactional(async (txEm) => {
      const user = await findOneWithDecryption(
        txEm, User, { id: userId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      )
      if (!user) return null
      const now = new Date()
      const affected = await txEm.nativeUpdate(
        PasswordReset,
        { id: row.id, user: userId, token: hashAuthToken(token), usedAt: null, expiresAt: { $gt: now } },
        { usedAt: now },
      )
      if (affected === 0) return null
      user.passwordHash = passwordHash
      await txEm.flush()
      await txEm.nativeDelete(Session, { user: userId })
      return user
    })
  }
}
