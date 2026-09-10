import { UniqueConstraintViolationException } from '@mikro-orm/core'
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

// Use Symbol.for so the marker survives module duplication across bundle
// boundaries: the accept route and this service are bundled into separate
// chunks, so `instanceof` between them is false and the 409 mapping would
// silently degrade back into the raw 500 this error exists to prevent.
const CUSTOMER_INVITATION_EMAIL_CONFLICT_MARKER = Symbol.for('@open-mercato/CustomerInvitationEmailConflictError')

export class CustomerInvitationEmailConflictError extends Error {
  readonly [CUSTOMER_INVITATION_EMAIL_CONFLICT_MARKER] = true

  constructor(public readonly email: string) {
    super('[internal] An account with this email address already exists')
    this.name = 'CustomerInvitationEmailConflictError'
  }
}

/**
 * Bundle-safe check for {@link CustomerInvitationEmailConflictError}. Always prefer
 * this over `instanceof` — API routes reach this service through DI and resolve a
 * different copy of this module.
 */
export function isCustomerInvitationEmailConflictError(
  error: unknown,
): error is CustomerInvitationEmailConflictError {
  return !!error
    && typeof error === 'object'
    && (error as Record<symbol, unknown>)[CUSTOMER_INVITATION_EMAIL_CONFLICT_MARKER] === true
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Unique-constraint detection that does not depend on `instanceof`: the MikroORM
 * copy this module is bundled with is not necessarily the one the driver throws
 * from, so fall back to the exception name and the Postgres SQLSTATE.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown; cause?: unknown }
  if (candidate.name === 'UniqueConstraintViolationException') return true
  if (candidate.code === POSTGRES_UNIQUE_VIOLATION) return true
  const cause = candidate.cause as { code?: unknown } | undefined
  return !!cause && typeof cause === 'object' && cause.code === POSTGRES_UNIQUE_VIOLATION
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

    const emailHash = hashForLookup(invitation.email)

    // A soft-deleted CustomerUser row does not block re-invitation (the unique
    // index only applies to non-deleted rows), but an active account with the
    // same email is a genuine conflict — fail with a domain error here instead
    // of letting the DB unique-constraint violation surface as a raw 500.
    // The lookup matches both hash formats: rows written before the keyed digest
    // still carry the legacy hash, and the partial index cannot relate the two.
    const existingActiveUser = await findOneWithDecryption(
      this.em,
      CustomerUser,
      {
        tenantId: invitation.tenantId,
        emailHash: { $in: lookupHashCandidates(invitation.email) },
        deletedAt: null,
      } as any,
      undefined,
      { tenantId: invitation.tenantId, organizationId: invitation.organizationId },
    )
    if (existingActiveUser) {
      throw new CustomerInvitationEmailConflictError(invitation.email)
    }

    const passwordHash = await hash(password, BCRYPT_COST)

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

    // The guard above is only the friendly fast path: it and this write are
    // separated by a bcrypt hash and a role query, so two concurrent accepts can
    // both pass it. The partial unique index is the real authority — translate
    // its violation onto the same domain error so both paths answer 409.
    try {
      await this.em.flush()
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new CustomerInvitationEmailConflictError(invitation.email)
      }
      throw error
    }
    return { user, invitation }
  }
}
