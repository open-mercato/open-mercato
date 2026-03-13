import { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000 // 15 minutes
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 60 minutes

export class CustomerTokenService {
  constructor(private em: EntityManager) {}

  async createEmailVerification(userId: string, tenantId: string): Promise<string> {
    const token = generateSecureToken()
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
    const record = this.em.create(CustomerUserEmailVerification, {
      user: userId as any,
      token,
      purpose: 'email_verification',
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persistAndFlush(record)
    return token
  }

  async createMagicLink(userId: string, tenantId: string): Promise<string> {
    const token = generateSecureToken()
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS)
    const record = this.em.create(CustomerUserEmailVerification, {
      user: userId as any,
      token,
      purpose: 'magic_link',
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persistAndFlush(record)
    return token
  }

  async createPasswordReset(userId: string, tenantId: string): Promise<string> {
    const token = generateSecureToken()
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    const record = this.em.create(CustomerUserPasswordReset, {
      user: userId as any,
      token,
      expiresAt,
      createdAt: new Date(),
    } as any)
    await this.em.persistAndFlush(record)
    return token
  }

  async verifyEmailToken(token: string, purpose: string): Promise<{ userId: string } | null> {
    const record = await this.em.findOne(CustomerUserEmailVerification, {
      token,
      purpose,
    }, { populate: ['user'] })
    if (!record) return null
    if (record.usedAt) return null
    if (record.expiresAt.getTime() < Date.now()) return null

    record.usedAt = new Date()
    await this.em.flush()
    const user = record.user as any
    return { userId: typeof user === 'string' ? user : user.id }
  }

  async verifyPasswordResetToken(token: string): Promise<{ userId: string } | null> {
    const record = await this.em.findOne(CustomerUserPasswordReset, {
      token,
    }, { populate: ['user'] })
    if (!record) return null
    if (record.usedAt) return null
    if (record.expiresAt.getTime() < Date.now()) return null

    record.usedAt = new Date()
    await this.em.flush()
    const user = record.user as any
    return { userId: typeof user === 'string' ? user : user.id }
  }
}
