import { EntityManager } from '@mikro-orm/postgresql'
import { hash } from 'bcryptjs'
import {
  CustomerUser,
  CustomerUserInvitation,
  CustomerUserRole,
  CustomerRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { generateSecureToken, hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const BCRYPT_COST = 10
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000 // 72 hours

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
  ): Promise<{ invitation: CustomerUserInvitation; rawToken: string }> {
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
      return { invitation: existing, rawToken: token }
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
    return { invitation, rawToken: token }
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

    await this.em.flush()
    return { user, invitation }
  }
}
