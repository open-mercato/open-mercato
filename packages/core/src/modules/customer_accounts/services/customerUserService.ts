import { EntityManager } from '@mikro-orm/postgresql'
import { hash, compare } from 'bcryptjs'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'

const BCRYPT_COST = 10
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export class CustomerUserService {
  constructor(private em: EntityManager) {}

  async createUser(
    email: string,
    password: string,
    displayName: string,
    scope: { tenantId: string; organizationId: string },
  ): Promise<CustomerUser> {
    const passwordHash = await hash(password, BCRYPT_COST)
    const emailHash = hashForLookup(email)
    const user = this.em.create(CustomerUser, {
      email: email.toLowerCase().trim(),
      emailHash,
      passwordHash,
      displayName,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      failedLoginAttempts: 0,
      createdAt: new Date(),
    } as any)
    return user as CustomerUser
  }

  async findByEmail(email: string, tenantId: string): Promise<CustomerUser | null> {
    const emailHash = hashForLookup(email)
    return this.em.findOne(CustomerUser, {
      emailHash,
      tenantId,
      deletedAt: null,
    })
  }

  async findById(id: string, tenantId: string): Promise<CustomerUser | null> {
    return this.em.findOne(CustomerUser, { id, tenantId, deletedAt: null })
  }

  async verifyPassword(user: CustomerUser, password: string): Promise<boolean> {
    if (!user.passwordHash) return false
    return compare(password, user.passwordHash)
  }

  async updateLastLoginAt(user: CustomerUser): Promise<void> {
    const now = new Date()
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, { lastLoginAt: now })
    user.lastLoginAt = now
  }

  checkLockout(user: CustomerUser): boolean {
    if (!user.lockedUntil) return false
    if (user.lockedUntil.getTime() > Date.now()) return true
    return false
  }

  async incrementFailedAttempts(user: CustomerUser): Promise<void> {
    const newCount = (user.failedLoginAttempts || 0) + 1
    const updates: Record<string, unknown> = { failedLoginAttempts: newCount }
    if (newCount >= MAX_FAILED_ATTEMPTS) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS)
    }
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, updates)
    user.failedLoginAttempts = newCount
    if (updates.lockedUntil) user.lockedUntil = updates.lockedUntil as Date
  }

  async resetFailedAttempts(user: CustomerUser): Promise<void> {
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
    user.failedLoginAttempts = 0
    user.lockedUntil = null
  }

  async updatePassword(user: CustomerUser, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, BCRYPT_COST)
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, { passwordHash })
    user.passwordHash = passwordHash
  }

  async updateProfile(user: CustomerUser, data: { displayName?: string }): Promise<void> {
    const updates: Record<string, unknown> = {}
    if (data.displayName !== undefined) updates.displayName = data.displayName
    if (Object.keys(updates).length === 0) return
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, updates)
    if (data.displayName !== undefined) user.displayName = data.displayName
  }

  async softDelete(userId: string): Promise<void> {
    await this.em.nativeUpdate(CustomerUser, { id: userId }, {
      deletedAt: new Date(),
      isActive: false,
    })
  }
}
