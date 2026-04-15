import { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerUser,
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken, hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000 // 15 minutes
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 60 minutes

export class CustomerTokenService {
  constructor(private em: EntityManager) {}

  async createEmailVerification(userId: string, tenantId: string): Promise<string> {
    const rawToken = generateSecureToken()
    const tokenHashed = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
    const record = this.em.create(CustomerUserEmailVerification, {
      user: userId as any,
      token: tokenHashed,
      purpose: 'email_verification',
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persist(record).flush()
    return rawToken
  }

  async createMagicLink(userId: string, tenantId: string): Promise<string> {
    const rawToken = generateSecureToken()
    const tokenHashed = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS)
    const record = this.em.create(CustomerUserEmailVerification, {
      user: userId as any,
      token: tokenHashed,
      purpose: 'magic_link',
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persist(record).flush()
    return rawToken
  }

  async createPasswordReset(userId: string, tenantId: string): Promise<string> {
    const rawToken = generateSecureToken()
    const tokenHashed = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    const record = this.em.create(CustomerUserPasswordReset, {
      user: userId as any,
      token: tokenHashed,
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persist(record).flush()
    return rawToken
  }

  async verifyEmailToken(token: string, purpose: string, tenantId?: string): Promise<{ userId: string; tenantId: string } | null> {
    const tokenHashed = hashToken(token)
    const record = await this.em.findOne(CustomerUserEmailVerification, {
      token: tokenHashed,
      purpose,
    }, { populate: ['user'] })
    if (!record) return null
    if (record.usedAt) return null
    if (record.expiresAt.getTime() < Date.now()) return null

    const user = record.user as CustomerUser
    if (tenantId && user?.tenantId !== tenantId) return null

    const knex = this.em.getKnex()
    const consumed = await knex('customer_user_email_verifications')
      .where('id', record.id)
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .update({ used_at: new Date() })
    if (consumed === 0) return null

    const resolvedUserId = typeof user === 'string' ? user : user.id
    const resolvedTenantId = typeof user === 'string' ? '' : user.tenantId
    return { userId: resolvedUserId, tenantId: resolvedTenantId }
  }

  async verifyPasswordResetToken(token: string, tenantId?: string): Promise<{ userId: string; tenantId: string } | null> {
    const tokenHashed = hashToken(token)
    const record = await this.em.findOne(CustomerUserPasswordReset, {
      token: tokenHashed,
    }, { populate: ['user'] })
    if (!record) return null
    if (record.usedAt) return null
    if (record.expiresAt.getTime() < Date.now()) return null

    const user = record.user as CustomerUser
    if (tenantId && user?.tenantId !== tenantId) return null

    const knex = this.em.getKnex()
    const consumed = await knex('customer_user_password_resets')
      .where('id', record.id)
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .update({ used_at: new Date() })
    if (consumed === 0) return null

    const resolvedUserId = typeof user === 'string' ? user : user.id
    const resolvedTenantId = typeof user === 'string' ? '' : user.tenantId
    return { userId: resolvedUserId, tenantId: resolvedTenantId }
  }
}
