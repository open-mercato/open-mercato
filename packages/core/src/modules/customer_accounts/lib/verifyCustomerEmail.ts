import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { organizationEventScope } from '@open-mercato/shared/lib/events/organization-scope'
import { CustomerUser } from '../data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import type { CustomerSessionService } from '../services/customerSessionService'
import type { CustomerUserService } from '../services/customerUserService'
import { signupExpiryCutoff } from './pendingSignup'

export async function verifyCustomerEmail(
  em: EntityManager,
  identity: { userId: string; tenantId: string; organizationId?: string },
  sessions: CustomerSessionService,
  options?: { password: string; users: CustomerUserService; reset?: boolean },
): Promise<{ user: CustomerUser; newlyVerified: boolean } | null> {
  const { userId, tenantId, organizationId } = identity
  const user = await findOneWithDecryption(
    em,
    CustomerUser,
    { id: userId, tenantId, ...(organizationId ? { organizationId } : {}), deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    { tenantId, organizationId },
  )
  if (!user?.isActive) return null

  const now = new Date()
  const newlyVerified = !user.emailVerifiedAt
  if (newlyVerified && !user.lastLoginAt && user.createdAt <= signupExpiryCutoff(now)) return null
  if (!newlyVerified && !options) return { user, newlyVerified }
  if (!newlyVerified && !options?.reset && user.passwordHash) {
    return null
  }

  const scope = { id: user.id, tenantId, organizationId: user.organizationId }
  if (options) {
    await options.users.updatePassword(user, options.password, em)
  }
  if (newlyVerified) {
    await em.nativeUpdate(CustomerUser, scope, {
      emailVerifiedAt: now,
      ...(options ? {} : { passwordHash: null }),
    })
  }
  await sessions.revokeAllUserSessions(user.id, em)
  return { user, newlyVerified }
}

export function emitCustomerEmailVerified(user: CustomerUser, verifiedBy?: string): void {
  void emitCustomerAccountsEvent('customer_accounts.email.verified', {
    id: user.id,
    userId: user.id,
    recipientUserId: user.id,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    ...(verifiedBy ? { email: user.email, verifiedBy } : {}),
  }, organizationEventScope(user)).catch(() => undefined)
}
