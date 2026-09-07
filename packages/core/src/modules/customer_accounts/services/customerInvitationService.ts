import { EntityManager } from '@mikro-orm/postgresql'
import { hash } from 'bcryptjs'
import {
  CustomerUser,
  CustomerUserInvitation,
  CustomerUserRole,
  CustomerRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken, hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'
import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const BCRYPT_COST = 10
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000 // 72 hours

export const CUSTOMER_INVITATION_ACCOUNT_EXISTS_CODE = 'customer_accounts.invitation.account_exists'

/**
 * Raised by {@link CustomerInvitationService.acceptInvitation} when the invited address already
 * owns a portal account in the same tenant. Callers MUST discriminate on the `code` property
 * rather than `instanceof`: the service is resolved through DI, so a production bundle can hold
 * more than one copy of this class and `instanceof` then silently returns false.
 */
export class CustomerInvitationAccountExistsError extends Error {
  readonly code = CUSTOMER_INVITATION_ACCOUNT_EXISTS_CODE

  constructor() {
    super('[internal] A portal account already exists for the invited email address')
    this.name = 'CustomerInvitationAccountExistsError'
  }
}

export function isCustomerInvitationAccountExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === CUSTOMER_INVITATION_ACCOUNT_EXISTS_CODE
}

const CUSTOMER_USERS_EMAIL_UNIQUE_CONSTRAINT = 'customer_users_tenant_email_hash_uniq'
const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * The pre-insert lookup in {@link CustomerInvitationService.acceptInvitation} is a check-then-act,
 * so two concurrent accepts for the same address (a double-submitted form, two invitations racing)
 * can both pass it and let the second one reach the database. Recognising the resulting unique
 * violation keeps that race on the same 409 answer instead of a 500. MikroORM wraps driver errors,
 * so the original is inspected through `cause`/`previous` as well, again without `instanceof`.
 */
function isCustomerUserEmailUniqueViolation(error: unknown): boolean {
  const candidates = [
    error,
    (error as { cause?: unknown } | null)?.cause,
    (error as { previous?: unknown } | null)?.previous,
  ]
  return candidates.some((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return false
    const { code, constraint, message } = candidate as {
      code?: unknown
      constraint?: unknown
      message?: unknown
    }
    if (code !== POSTGRES_UNIQUE_VIOLATION) return false
    return constraint === CUSTOMER_USERS_EMAIL_UNIQUE_CONSTRAINT
      || (typeof message === 'string' && message.includes(CUSTOMER_USERS_EMAIL_UNIQUE_CONSTRAINT))
  })
}

export type CustomerInvitationRollbackState = {
  email: string
  token: string
  customerEntityId: string | null
  personEntityId: string | null
  roleIdsJson: string[]
  invitedByUserId: string | null
  invitedByCustomerUserId: string | null
  displayName: string | null
  expiresAt: Date
}

export class CustomerInvitationService {
  constructor(private em: EntityManager) {}

  async createInvitation(
    email: string,
    scope: { tenantId: string; organizationId: string },
    options: {
      customerEntityId?: string | null
      personEntityId?: string | null
      roleIds: string[]
      invitedByUserId?: string | null
      invitedByCustomerUserId?: string | null
      displayName?: string | null
    },
  ): Promise<{
    invitation: CustomerUserInvitation
    rawToken: string
    reused: boolean
    rollbackState: CustomerInvitationRollbackState | null
  }> {
    const token = generateSecureToken()
    const emailHash = hashForLookup(email)
    const normalizedEmail = email.toLowerCase().trim()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    const tokenHashed = hashToken(token)

    // Dedupe: reuse an existing pending (not accepted, not cancelled, unexpired)
    // invitation for the same recipient instead of inserting a new row. This caps
    // row/token growth and keeps a single live token per concurrently-pending
    // (tenant, organization, email) tuple.
    const existing = await findOneWithDecryption(
      this.em,
      CustomerUserInvitation,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        emailHash,
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: { $gt: new Date() },
      } as any,
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (existing) {
      const rollbackState: CustomerInvitationRollbackState = {
        email: existing.email,
        token: existing.token,
        customerEntityId: existing.customerEntityId ?? null,
        personEntityId: existing.personEntityId ?? null,
        roleIdsJson: [...(existing.roleIdsJson ?? [])],
        invitedByUserId: existing.invitedByUserId ?? null,
        invitedByCustomerUserId: existing.invitedByCustomerUserId ?? null,
        displayName: existing.displayName ?? null,
        expiresAt: new Date(existing.expiresAt),
      }
      existing.email = normalizedEmail
      existing.token = tokenHashed
      existing.customerEntityId = options.customerEntityId || null
      existing.personEntityId = options.personEntityId || null
      existing.roleIdsJson = options.roleIds
      existing.invitedByUserId = options.invitedByUserId || null
      existing.invitedByCustomerUserId = options.invitedByCustomerUserId || null
      existing.displayName = options.displayName || null
      existing.expiresAt = expiresAt
      await this.em.flush()
      return { invitation: existing, rawToken: token, reused: true, rollbackState }
    }

    const invitation = this.em.create(CustomerUserInvitation, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      email: normalizedEmail,
      emailHash,
      token: tokenHashed,
      customerEntityId: options.customerEntityId || null,
      personEntityId: options.personEntityId || null,
      roleIdsJson: options.roleIds,
      invitedByUserId: options.invitedByUserId || null,
      invitedByCustomerUserId: options.invitedByCustomerUserId || null,
      displayName: options.displayName || null,
      expiresAt,
      createdAt: new Date(),
    } as any) as CustomerUserInvitation
    await this.em.persist(invitation).flush()
    return { invitation, rawToken: token, reused: false, rollbackState: null }
  }

  async rollbackInvitation(
    invitation: CustomerUserInvitation,
    rollbackState: CustomerInvitationRollbackState | null,
  ): Promise<void> {
    if (!rollbackState) {
      await this.em.remove(invitation).flush()
      return
    }

    invitation.email = rollbackState.email
    invitation.token = rollbackState.token
    invitation.customerEntityId = rollbackState.customerEntityId
    invitation.personEntityId = rollbackState.personEntityId
    invitation.roleIdsJson = [...rollbackState.roleIdsJson]
    invitation.invitedByUserId = rollbackState.invitedByUserId
    invitation.invitedByCustomerUserId = rollbackState.invitedByCustomerUserId
    invitation.displayName = rollbackState.displayName
    invitation.expiresAt = new Date(rollbackState.expiresAt)
    await this.em.flush()
  }

  async findByToken(token: string): Promise<CustomerUserInvitation | null> {
    const tokenHashed = hashToken(token)
    const invitation = await findOneWithDecryption(
      this.em,
      CustomerUserInvitation,
      { token: tokenHashed } as any,
    )
    if (!invitation) return null
    if (invitation.acceptedAt) return null
    if (invitation.cancelledAt) return null
    if (invitation.expiresAt.getTime() < Date.now()) return null
    return invitation
  }

  async acceptInvitation(
    token: string,
    password: string,
    displayName: string,
  ): Promise<{ user: CustomerUser; invitation: CustomerUserInvitation } | null> {
    const invitation = await this.findByToken(token)
    if (!invitation) return null

    // customer_users carries a (tenant_id, email_hash) unique constraint, so inserting a second
    // account for an address that was already invited and activated raises a driver-level unique
    // violation the caller can only surface as a 500. Detect it up front and let the caller answer
    // with a message the invitee can act on (#5899). The lookup deliberately omits `deletedAt` —
    // the constraint is not partial, so a soft-deleted account collides just the same.
    const existingUser = await findOneWithDecryption(
      this.em,
      CustomerUser,
      {
        emailHash: { $in: lookupHashCandidates(invitation.email) },
        tenantId: invitation.tenantId,
      } as any,
      undefined,
      { tenantId: invitation.tenantId, organizationId: invitation.organizationId },
    )
    if (existingUser) throw new CustomerInvitationAccountExistsError()

    const passwordHash = await hash(password, BCRYPT_COST)
    const emailHash = hashForLookup(invitation.email)

    // Create user
    const user = this.em.create(CustomerUser, {
      email: invitation.email,
      emailHash,
      passwordHash,
      displayName: displayName || invitation.displayName || invitation.email,
      tenantId: invitation.tenantId,
      organizationId: invitation.organizationId,
      customerEntityId: invitation.customerEntityId || null,
      personEntityId: invitation.personEntityId || null,
      isActive: true,
      emailVerifiedAt: new Date(), // Invitation implicitly verifies email
      failedLoginAttempts: 0,
      createdAt: new Date(),
    } as any) as CustomerUser
    this.em.persist(user)

    // Assign roles
    const roleIds = Array.isArray(invitation.roleIdsJson) ? invitation.roleIdsJson : []
    const roles = roleIds.length > 0
      ? await findWithDecryption(
          this.em,
          CustomerRole,
          {
            id: { $in: roleIds } as any,
            tenantId: invitation.tenantId,
            organizationId: invitation.organizationId,
            deletedAt: null,
          } as any,
          undefined,
          { tenantId: invitation.tenantId, organizationId: invitation.organizationId },
        )
      : []
    for (const role of roles) {
      const userRole = this.em.create(CustomerUserRole, {
        user,
        role,
        createdAt: new Date(),
      } as any)
      this.em.persist(userRole)
    }

    // Mark invitation as accepted
    invitation.acceptedAt = new Date()

    try {
      await this.em.flush()
    } catch (error) {
      if (isCustomerUserEmailUniqueViolation(error)) throw new CustomerInvitationAccountExistsError()
      throw error
    }
    return { user, invitation }
  }
}
