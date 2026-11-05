import type { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSecurityEvent } from '../events'

const BCRYPT_COST = 10

export type PasswordPolicyValidation = {
  valid: boolean
  errors: string[]
}

export class PasswordServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errors?: string[],
  ) {
    super(message)
    this.name = 'PasswordServiceError'
  }
}

export class PasswordService {
  constructor(private em: EntityManager) {}

  validatePasswordPolicy(password: string): PasswordPolicyValidation {
    const validation = validatePassword(password)
    return {
      valid: validation.ok,
      errors: validation.violations,
    }
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.findUserById(userId)
    if (!user?.passwordHash) return false
    return compare(password, user.passwordHash)
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.findUserById(userId)
    if (!user) {
      throw new PasswordServiceError('User not found', 404)
    }
    if (!user.passwordHash) {
      throw new PasswordServiceError('Password authentication is not available for this user', 400)
    }

    const currentPasswordValid = await compare(currentPassword, user.passwordHash)
    if (!currentPasswordValid) {
      throw new PasswordServiceError('Current password is invalid', 401)
    }

    const policyValidation = this.validatePasswordPolicy(newPassword)
    if (!policyValidation.valid) {
      throw new PasswordServiceError(
        'Password does not meet the requirements',
        400,
        policyValidation.errors,
      )
    }

    const sameAsCurrent = await compare(newPassword, user.passwordHash)
    if (sameAsCurrent) {
      throw new PasswordServiceError('New password must be different from current password', 400)
    }

    user.passwordHash = await hash(newPassword, BCRYPT_COST)
    await this.em.flush()
    const changedAt = new Date().toISOString()
    const eventPayload = {
      userId,
      tenantId: user.tenantId ?? null,
      organizationId: user.organizationId ?? null,
      changedAt,
    }
    await emitSecurityEvent('security.password.changed', eventPayload)
    await emitSecurityEvent('security.password.notification_requested', eventPayload)
  }

  private async findUserById(userId: string): Promise<User | null> {
    return findOneWithDecryption(
      this.em,
      User,
      { id: userId, deletedAt: null },
      undefined,
      {},
    )
  }
}

export default PasswordService
