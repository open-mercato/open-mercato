import { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken, hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'

const DEFAULT_SESSION_TTL_DAYS = 30

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

    const session = this.em.create(CustomerUserSession, {
      user,
      tokenHash,
      ipAddress: ip || null,
      userAgent: userAgent || null,
      expiresAt,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    } as any) as CustomerUserSession
    await this.em.persistAndFlush(session)

    const jwt = this.signCustomerJwt(user, resolvedFeatures)

    return { rawToken, jwt, session }
  }

  signCustomerJwt(user: CustomerUser, resolvedFeatures: string[]): string {
    return signJwt({
      sub: user.id,
      type: 'customer',
      tenantId: user.tenantId,
      orgId: user.organizationId,
      email: user.email,
      displayName: user.displayName || '',
      customerEntityId: user.customerEntityId || null,
      personEntityId: user.personEntityId || null,
      resolvedFeatures,
    })
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
    const jwt = this.signCustomerJwt(user, resolvedFeatures)
    return { jwt, user }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.em.nativeUpdate(CustomerUserSession, { id: sessionId }, { deletedAt: new Date() })
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.em.nativeUpdate(
      CustomerUserSession,
      { user: userId as any, deletedAt: null },
      { deletedAt: new Date() },
    )
  }
}
