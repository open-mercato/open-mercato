import { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken, hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'
import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const CUSTOMER_JWT_AUDIENCE = 'customer'
const CUSTOMER_JWT_TTL_SECONDS = 60 * 60 * 8

const DEFAULT_SESSION_TTL_DAYS = 30
const DEFAULT_MAX_SESSIONS_PER_USER = 5

function resolveMaxSessionsPerUser(): number {
  const raw = process.env.MAX_CUSTOMER_SESSIONS_PER_USER
  if (!raw) return DEFAULT_MAX_SESSIONS_PER_USER
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SESSIONS_PER_USER
  return Math.floor(parsed)
}

export class CustomerSessionService {
  constructor(private em: EntityManager) {}

  async createSession(
    user: CustomerUser,
    resolvedFeatures: string[],
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<{ rawToken: string; jwt: string; session: CustomerUserSession }> {
    const rawToken = generateSecureToken()
    const tokenHash = hashToken(rawToken)
    const days = Number(process.env.CUSTOMER_SESSION_TTL_DAYS || DEFAULT_SESSION_TTL_DAYS)
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    await this.enforceSessionCap(user.id, user.tenantId, user.organizationId)

    const session = this.em.create(CustomerUserSession, {
      user,
      tokenHash,
      ipAddress: ip || null,
      userAgent: userAgent || null,
      expiresAt,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    } as any) as CustomerUserSession
    await this.em.persist(session).flush()

    const jwt = this.signCustomerJwt(user, resolvedFeatures, session.id)

    return { rawToken, jwt, session }
  }

  signCustomerJwt(user: CustomerUser, resolvedFeatures: string[], sessionId: string): string {
    return signAudienceJwt(
      CUSTOMER_JWT_AUDIENCE,
      {
        sub: user.id,
        sid: sessionId,
        type: 'customer',
        tenantId: user.tenantId,
        orgId: user.organizationId,
        email: user.email,
        displayName: user.displayName || '',
        customerEntityId: user.customerEntityId || null,
        personEntityId: user.personEntityId || null,
        resolvedFeatures,
      },
      CUSTOMER_JWT_TTL_SECONDS,
    )
  }

  async findByToken(rawToken: string, tenantId?: string): Promise<CustomerUserSession | null> {
    const tokenHash = hashToken(rawToken)
    const session = await this.em.findOne(CustomerUserSession, {
      tokenHash,
      deletedAt: null,
    }, { populate: ['user'] })
    if (!session) return null
    if (session.expiresAt.getTime() < Date.now()) return null
    const user = session.user as CustomerUser
    if (tenantId && user?.tenantId !== tenantId) return null
    return session
  }

  async refreshSession(
    rawToken: string,
    resolvedFeatures: string[],
  ): Promise<{ jwt: string; user: CustomerUser } | null> {
    const session = await this.findByToken(rawToken)
    if (!session) return null
    const user = session.user as CustomerUser
    if (!user || user.deletedAt || !user.isActive) return null

    await this.em.nativeUpdate(CustomerUserSession, { id: session.id }, { lastUsedAt: new Date() })
    const jwt = this.signCustomerJwt(user, resolvedFeatures, session.id)
    return { jwt, user }
  }

  async findActiveSessionById(sessionId: string): Promise<CustomerUserSession | null> {
    const session = await this.em.findOne(CustomerUserSession, {
      id: sessionId,
      deletedAt: null,
    })
    if (!session) return null
    if (session.expiresAt.getTime() < Date.now()) return null
    return session
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.em.nativeUpdate(CustomerUserSession, { id: sessionId }, { deletedAt: new Date() })
  }

  private async enforceSessionCap(
    userId: string,
    tenantId: string,
    organizationId: string,
  ): Promise<void> {
    const cap = resolveMaxSessionsPerUser()
    const existing = await findWithDecryption(
      this.em,
      CustomerUserSession,
      {
        user: userId as any,
        deletedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { orderBy: { createdAt: 'asc' } },
      { tenantId, organizationId },
    )
    const toRevoke = existing.length - (cap - 1)
    if (toRevoke <= 0) return
    const oldestIds = existing.slice(0, toRevoke).map((s) => s.id)
    await this.em.nativeUpdate(
      CustomerUserSession,
      { id: { $in: oldestIds } },
      { deletedAt: new Date() },
    )
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const now = new Date()
    await this.em.nativeUpdate(
      CustomerUserSession,
      { user: userId as any, deletedAt: null },
      { deletedAt: now },
    )
    await this.em.nativeUpdate(
      CustomerUser,
      { id: userId },
      { sessionsRevokedAt: now },
    )
  }
}
