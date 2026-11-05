import { EntityManager } from '@mikro-orm/postgresql'
import { hash, compare } from 'bcryptjs'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const BCRYPT_COST = 10
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

type CustomerUserLockoutDatabase = {
  customer_users: {
    id: string
    failed_login_attempts: number
    locked_until: Date | null
  }
}

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
    return findOneWithDecryption(
      this.em,
      CustomerUser,
      {
        emailHash: { $in: lookupHashCandidates(email) },
        tenantId,
        deletedAt: null,
      } as any,
      undefined,
      { tenantId },
    )
  }

  async findById(
    id: string,
    tenantId: string,
    organizationId?: string | null,
  ): Promise<CustomerUser | null> {
    const where: Record<string, unknown> = { id, tenantId, deletedAt: null }
    if (organizationId !== undefined) where.organizationId = organizationId
    return findOneWithDecryption(
      this.em,
      CustomerUser,
      where as any,
      undefined,
      { tenantId, organizationId },
    )
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
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS)
    await this.em.getKysely<CustomerUserLockoutDatabase>()
      .updateTable('customer_users')
      .set((eb) => ({
        failed_login_attempts: eb('failed_login_attempts', '+', 1),
        locked_until: eb
          .case()
          .when('failed_login_attempts', '>=', MAX_FAILED_ATTEMPTS - 1)
          .then(eb.fn<Date>('greatest', [eb.ref('locked_until'), eb.val(lockedUntil)]))
          .else(eb.ref('locked_until'))
          .end(),
      }))
      .where('id', '=', user.id)
      .execute()
  }

  async resetFailedAttemptsUnlessLocked(user: CustomerUser): Promise<boolean> {
    const now = new Date()
    const row = await this.em.getKysely<CustomerUserLockoutDatabase>()
      .updateTable('customer_users')
      .set({ failed_login_attempts: 0, locked_until: null })
      .where('id', '=', user.id)
      .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<=', now)]))
      .returning('id')
      .executeTakeFirst()
    return row !== undefined
  }

  async resetFailedAttempts(user: CustomerUser): Promise<void> {
    await this.em.nativeUpdate(CustomerUser, { id: user.id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
  }

  async updatePassword(user: CustomerUser, newPassword: string, em?: EntityManager): Promise<void> {
    const passwordHash = await hash(newPassword, BCRYPT_COST)
    await (em ?? this.em).nativeUpdate(CustomerUser, {
      id: user.id,
      tenantId: user.tenantId,
      organizationId: user.organizationId,
    }, { passwordHash })
    user.passwordHash = passwordHash
  }

  // `display_name` is encrypted at rest. `nativeUpdate` issues raw SQL and fires none of the
  // flush hooks the tenant-encryption subscriber depends on, so writing it that way persists
  // plaintext PII into a ciphertext column (#3837). Assign it on the managed entity and flush
  // so `beforeUpdate` encrypts the value on its way to the database.
  async updateProfile(user: CustomerUser, data: { displayName?: string }): Promise<void> {
    if (data.displayName === undefined) return
    const managed = await findOneWithDecryption(
      this.em,
      CustomerUser,
      { id: user.id, tenantId: user.tenantId, organizationId: user.organizationId, deletedAt: null } as any,
      undefined,
      { tenantId: user.tenantId, organizationId: user.organizationId },
    )
    if (!managed) return
    managed.displayName = data.displayName
    await this.em.flush()
    user.displayName = data.displayName
  }

  async softDelete(
    userId: string,
    scope?: { tenantId: string; organizationId: string | null },
  ): Promise<void> {
    const where: Record<string, unknown> = { id: userId }
    if (scope) {
      where.tenantId = scope.tenantId
      where.organizationId = scope.organizationId
    }
    await this.em.nativeUpdate(CustomerUser, where, {
      deletedAt: new Date(),
      isActive: false,
    })
  }
}
