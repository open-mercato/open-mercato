/** @jest-environment node */
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { hash } from 'bcryptjs'
import {
  CustomerInvitationEmailConflictError,
  CustomerInvitationService,
  isCustomerInvitationEmailConflictError,
} from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import {
  CustomerRole,
  CustomerUser,
  CustomerUserInvitation,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tenantEligibility', () => ({
  isCustomerTenantActive: jest.fn(async () => true),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator', () => ({
  generateSecureToken: jest.fn(() => 'raw-token'),
  hashToken: jest.fn(() => 'hashed-token'),
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  hashForLookup: jest.fn(() => 'email-hash'),
  lookupHashCandidates: jest.fn(() => ['email-hash', 'legacy-email-hash']),
}))

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed-${value}`),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: any, entity: any, where: any, options?: any) => em.find(entity, where, options),
  findOneWithDecryption: (em: any, entity: any, where: any, options?: any) => em.findOne(entity, where, options),
  findAndCountWithDecryption: (em: any, entity: any, where: any, options?: any) => em.findAndCount(entity, where, options),
}))

describe('CustomerInvitationService invitation terminal transitions', () => {
  const scope = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
  }
  const invitationId = '33333333-3333-4333-8333-333333333333'

  function buildFixture() {
    const invitation = {
      id: invitationId,
      ...scope,
      email: 'invitee@example.com',
      token: 'hashed-token',
      roleIdsJson: [],
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation
    const transactionEm = {
      nativeUpdate: jest.fn(async () => 1),
      findOne: jest.fn(async () => null),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    const transactional = jest.fn(async (operation: (em: EntityManager) => Promise<unknown>) =>
      operation(transactionEm as unknown as EntityManager),
    )
    const rootEm = {
      findOne: jest.fn(async () => invitation),
      nativeUpdate: jest.fn(async () => 1),
      transactional,
    }
    const service = new CustomerInvitationService(rootEm as unknown as EntityManager)
    return { service, invitation, rootEm, transactionEm }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('cancels only an unexpired pending invitation in the supplied tenant and organization', async () => {
    const { service, rootEm } = buildFixture()

    await expect(service.cancelInvitation(invitationId, scope)).resolves.toBe(true)

    expect(rootEm.nativeUpdate).toHaveBeenCalledWith(CustomerUserInvitation, {
      id: invitationId,
      ...scope,
      acceptedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: expect.any(Date) },
    }, { cancelledAt: expect.any(Date) })
    expect(rootEm.findOne).not.toHaveBeenCalled()
    expect(rootEm.transactional).not.toHaveBeenCalled()
  })

  it('returns a neutral unchanged outcome for missing, out-of-scope, or terminal invitations', async () => {
    const { service, rootEm } = buildFixture()
    rootEm.nativeUpdate.mockResolvedValue(0)

    await expect(service.cancelInvitation(invitationId, scope)).resolves.toBe(false)
  })

  it.each([
    { tenantId: '', organizationId: scope.organizationId },
    { tenantId: scope.tenantId, organizationId: '' },
  ])('refuses an incomplete scope without querying', async (incompleteScope) => {
    const { service, rootEm } = buildFixture()

    await expect(service.cancelInvitation(invitationId, incompleteScope)).resolves.toBe(false)
    expect(rootEm.nativeUpdate).not.toHaveBeenCalled()
  })

  it('does not create a user if cancellation wins during password hashing', async () => {
    const { service, transactionEm } = buildFixture()
    jest.mocked(hash).mockImplementationOnce(async () => {
      await service.cancelInvitation(invitationId, scope)
      transactionEm.nativeUpdate.mockResolvedValue(0)
      return 'hashed-password'
    })

    await expect(service.acceptInvitation('raw-token', 'Password123!', 'Invitee')).resolves.toBeNull()
    expect(transactionEm.create).not.toHaveBeenCalled()
    expect(transactionEm.persist).not.toHaveBeenCalled()
    expect(transactionEm.flush).not.toHaveBeenCalled()
  })

  it('rechecks the original token and pending state atomically within the user creation transaction', async () => {
    const { service, invitation, rootEm, transactionEm } = buildFixture()

    const result = await service.acceptInvitation('raw-token', 'Password123!', 'Invitee')

    expect(rootEm.transactional).toHaveBeenCalledTimes(1)
    expect(transactionEm.nativeUpdate).toHaveBeenCalledWith(CustomerUserInvitation, {
      id: invitationId,
      ...scope,
      token: 'hashed-token',
      acceptedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: expect.any(Date) },
    }, { acceptedAt: expect.any(Date) })
    expect(result?.invitation.acceptedAt).toBeInstanceOf(Date)
    expect(transactionEm.create).toHaveBeenCalledTimes(1)
    expect(transactionEm.flush).toHaveBeenCalledTimes(1)
    expect(result?.invitation).toBe(invitation)
    expect(invitation.acceptedAt).toBeInstanceOf(Date)
  })

  it('propagates transaction failure without marking the original invitation accepted', async () => {
    const { service, invitation, transactionEm } = buildFixture()
    transactionEm.flush.mockRejectedValue(new Error('transaction failed'))

    await expect(service.acceptInvitation('raw-token', 'Password123!', 'Invitee'))
      .rejects.toThrow('transaction failed')
    expect(invitation.acceptedAt).toBeNull()
  })

  it.each(['cancelledAt', 'acceptedAt'] as const)('rejects an invitation already marked %s', async (field) => {
    const { service, invitation, rootEm } = buildFixture()
    invitation[field] = new Date()

    await expect(service.acceptInvitation('raw-token', 'Password123!', 'Invitee')).resolves.toBeNull()
    expect(rootEm.transactional).not.toHaveBeenCalled()
  })
})

describe('CustomerInvitationService.acceptInvitation — role lookup batching', () => {
  const roleIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ]
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  let mockEm: jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush' | 'nativeUpdate' | 'transactional'>>
  let service: CustomerInvitationService

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_: unknown, data: unknown) => data as any),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      nativeUpdate: jest.fn(async () => 1),
      transactional: jest.fn(async (operation: (transactionEm: EntityManager) => Promise<unknown>) => operation(mockEm as unknown as EntityManager)),
    } as unknown as jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush' | 'nativeUpdate' | 'transactional'>>
    service = new CustomerInvitationService(mockEm as unknown as EntityManager)
  })

  it('uses a single CustomerRole $in query for all invitation roleIds (not per-role findOne)', async () => {
    const invitation = {
      id: 'inv-1',
      email: 'new@example.com',
      tenantId,
      organizationId,
      customerEntityId: null,
      roleIdsJson: roleIds,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockImplementation(async (entity: unknown, where: any) => {
      if (entity === CustomerRole) {
        return (where.id.$in as string[]).map((id: string) => ({ id, tenantId, deletedAt: null }))
      }
      return []
    })

    const result = await service.acceptInvitation('raw-token', 'Secret123!', 'New User')
    expect(result).not.toBeNull()

    const roleFinds = (mockEm.find as jest.Mock).mock.calls.filter((call) => call[0] === CustomerRole)
    expect(roleFinds).toHaveLength(1)
    expect(roleFinds[0][1]).toMatchObject({
      id: { $in: roleIds },
      tenantId,
      organizationId,
      deletedAt: null,
    })
    expect(mockEm.findOne).not.toHaveBeenCalledWith(CustomerRole, expect.anything())

    const linkCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUserRole)
    expect(linkCreates).toHaveLength(roleIds.length)
  })

  it('does not link roles owned by another organization in the same tenant (#4032)', async () => {
    const foreignOrganizationId = '99999999-9999-4999-8999-999999999999'
    const localRoleId = roleIds[0]
    const foreignRoleId = roleIds[1]
    const invitation = {
      id: 'inv-3',
      email: 'new@example.com',
      tenantId,
      organizationId,
      customerEntityId: null,
      roleIdsJson: [localRoleId, foreignRoleId],
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockImplementation(async (entity: unknown, where: any) => {
      if (entity === CustomerRole) {
        const rolesByOrg: Record<string, { id: string; tenantId: string; organizationId: string; deletedAt: null }> = {
          [localRoleId]: { id: localRoleId, tenantId, organizationId, deletedAt: null },
          [foreignRoleId]: { id: foreignRoleId, tenantId, organizationId: foreignOrganizationId, deletedAt: null },
        }
        return (where.id.$in as string[])
          .map((id: string) => rolesByOrg[id])
          .filter((role) => role && (!where.organizationId || role.organizationId === where.organizationId))
      }
      return []
    })

    const result = await service.acceptInvitation('raw-token', 'Secret123!', 'New User')
    expect(result).not.toBeNull()

    const roleFinds = (mockEm.find as jest.Mock).mock.calls.filter((call) => call[0] === CustomerRole)
    expect(roleFinds).toHaveLength(1)
    expect(roleFinds[0][1]).toMatchObject({
      tenantId,
      organizationId,
      deletedAt: null,
    })

    const linkCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUserRole)
    expect(linkCreates).toHaveLength(1)
    expect((linkCreates[0][1] as { role: { id: string } }).role.id).toBe(localRoleId)
  })

  it('carries personEntityId from the invitation onto the new CustomerUser', async () => {
    const personEntityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const invitation = {
      id: 'inv-person',
      email: 'new@example.com',
      tenantId,
      organizationId,
      customerEntityId: null,
      personEntityId,
      roleIdsJson: [],
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])

    const result = await service.acceptInvitation('raw-token', 'Secret123!', 'New User')
    expect(result).not.toBeNull()

    const userCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUser)
    expect(userCreates).toHaveLength(1)
    expect((userCreates[0][1] as { personEntityId: string | null }).personEntityId).toBe(personEntityId)
  })

  it('skips the role query entirely when the invitation carries no roleIds', async () => {
    const invitation = {
      id: 'inv-2',
      email: 'new@example.com',
      tenantId,
      organizationId,
      customerEntityId: null,
      roleIdsJson: [],
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])

    await service.acceptInvitation('raw-token', 'Secret123!', 'New User')
    const roleFinds = (mockEm.find as jest.Mock).mock.calls.filter((call) => call[0] === CustomerRole)
    expect(roleFinds).toHaveLength(0)
  })
})

describe('CustomerInvitationService.acceptInvitation — soft-deleted email reuse (#5532)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  let mockEm: jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush' | 'nativeUpdate' | 'transactional'>>
  let service: CustomerInvitationService

  const buildInvitation = () => ({
    id: 'inv-reuse',
    email: 'reused@example.com',
    tenantId,
    organizationId,
    customerEntityId: null,
    personEntityId: null,
    roleIdsJson: [],
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    cancelledAt: null,
  }) as unknown as CustomerUserInvitation

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_: unknown, data: unknown) => data as any),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      nativeUpdate: jest.fn(async () => 1),
      transactional: jest.fn(async (operation: (transactionEm: EntityManager) => Promise<unknown>) => operation(mockEm as unknown as EntityManager)),
    } as unknown as jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush' | 'nativeUpdate' | 'transactional'>>
    service = new CustomerInvitationService(mockEm as unknown as EntityManager)
  })

  it('creates the user when only a soft-deleted CustomerUser row shares the email (the active-row lookup filters it out)', async () => {
    const invitation = buildInvitation()
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      if (entity === CustomerUser) return null
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])

    const result = await service.acceptInvitation('raw-token', 'Secret123!', 'Reused User')

    expect(result).not.toBeNull()
    const userFinds = (mockEm.findOne as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUser)
    expect(userFinds).toHaveLength(1)
    expect(userFinds[0][1]).toMatchObject({ tenantId, deletedAt: null })
    const userCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUser)
    expect(userCreates).toHaveLength(1)
  })

  it('matches the legacy lookup hash as well, so an active account written before the keyed digest is still found', async () => {
    const invitation = buildInvitation()
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])

    await service.acceptInvitation('raw-token', 'Secret123!', 'Reused User')

    const userFinds = (mockEm.findOne as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUser)
    expect(userFinds[0][1].emailHash).toEqual({ $in: ['email-hash', 'legacy-email-hash'] })
    // The new row must still be written under the primary hash only.
    const userCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUser)
    expect(userCreates[0][1]).toMatchObject({ emailHash: 'email-hash' })
  })

  it('maps a unique-constraint violation raised by the flush onto the same conflict error, so a concurrent accept cannot resurface the raw 500', async () => {
    const invitation = buildInvitation()
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])
    ;(mockEm.flush as jest.Mock).mockRejectedValue(
      new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint')),
    )

    await expect(service.acceptInvitation('raw-token', 'Secret123!', 'Reused User'))
      .rejects.toThrow(CustomerInvitationEmailConflictError)
  })

  it('maps a driver error carrying only the Postgres unique-violation SQLSTATE, since the thrown exception class may come from another MikroORM copy', async () => {
    const invitation = buildInvitation()
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])
    const foreignRealmViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      name: 'UniqueConstraintViolationException',
      code: '23505',
    })
    ;(mockEm.flush as jest.Mock).mockRejectedValue(foreignRealmViolation)

    await expect(service.acceptInvitation('raw-token', 'Secret123!', 'Reused User'))
      .rejects.toThrow(CustomerInvitationEmailConflictError)
  })

  it('lets an unrelated flush failure propagate untouched rather than reporting it as an email conflict', async () => {
    const invitation = buildInvitation()
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      return null
    })
    ;(mockEm.find as jest.Mock).mockResolvedValue([])
    ;(mockEm.flush as jest.Mock).mockRejectedValue(new Error('connection terminated'))

    await expect(service.acceptInvitation('raw-token', 'Secret123!', 'Reused User'))
      .rejects.toThrow('connection terminated')
  })

  it('throws CustomerInvitationEmailConflictError instead of creating a duplicate when an active CustomerUser already owns the email', async () => {
    const invitation = buildInvitation()
    const activeUser = { id: 'existing-user', tenantId, emailHash: 'email-hash', deletedAt: null }
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return invitation
      if (entity === CustomerUser) return activeUser
      return null
    })

    await expect(service.acceptInvitation('raw-token', 'Secret123!', 'Reused User'))
      .rejects.toThrow(CustomerInvitationEmailConflictError)
    expect(mockEm.create).not.toHaveBeenCalledWith(CustomerUser, expect.anything())
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})

describe('CustomerInvitationService.createInvitation — pending-invitation dedupe', () => {
  const roleIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ]
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  let mockEm: jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush'>>
  let service: CustomerInvitationService

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_: unknown, data: unknown) => data as any),
      persist: jest.fn(() => mockEm),
      flush: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush'>>
    service = new CustomerInvitationService(mockEm as unknown as EntityManager)
  })

  it('reuses an existing pending invitation instead of inserting a new row', async () => {
    const existing = {
      id: 'inv-existing',
      email: 'old@example.com',
      tenantId,
      organizationId,
      emailHash: 'email-hash',
      token: 'old-hashed-token',
      customerEntityId: null,
      roleIdsJson: ['old-role'],
      invitedByUserId: null,
      invitedByCustomerUserId: null,
      displayName: 'Old Name',
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return existing
      return null
    })

    const personEntityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const beforeExpiresAt = existing.expiresAt.getTime()
    const result = await service.createInvitation(
      ' New@Example.COM ',
      { tenantId, organizationId },
      { roleIds, personEntityId, invitedByUserId: 'inviter-1', displayName: 'Refreshed Name' },
    )

    expect(mockEm.create).not.toHaveBeenCalled()
    expect(result.invitation).toBe(existing)
    expect(result.rawToken).toBe('raw-token')
    expect(result.reused).toBe(true)
    expect(result.rollbackState).toMatchObject({
      email: 'old@example.com',
      token: 'old-hashed-token',
      roleIdsJson: ['old-role'],
      displayName: 'Old Name',
    })
    expect(existing.email).toBe('new@example.com')
    expect(existing.token).toBe('hashed-token')
    expect(existing.personEntityId).toBe(personEntityId)
    expect(existing.roleIdsJson).toEqual(roleIds)
    expect(existing.invitedByUserId).toBe('inviter-1')
    expect(existing.displayName).toBe('Refreshed Name')
    expect(existing.expiresAt.getTime()).toBeGreaterThan(beforeExpiresAt)
    expect(mockEm.flush).toHaveBeenCalled()

    const dedupeFinds = (mockEm.findOne as jest.Mock).mock.calls.filter(
      (call) => call[0] === CustomerUserInvitation,
    )
    expect(dedupeFinds).toHaveLength(1)
    expect(dedupeFinds[0][1]).toMatchObject({
      tenantId,
      organizationId,
      emailHash: 'email-hash',
      acceptedAt: null,
      cancelledAt: null,
    })
    expect(dedupeFinds[0][1].expiresAt).toHaveProperty('$gt')
  })

  // #5499: re-inviting the same address from a surface that only knows the company
  // (portal invite, admin users page) must not strip the person link off the row —
  // the person's account-status card finds the invitation through it — nor the
  // display name the invitation email is personalized with.
  it('keeps the existing person link and display name when the re-invite carries neither', async () => {
    const personEntityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const existing = {
      id: 'inv-existing',
      email: 'old@example.com',
      tenantId,
      organizationId,
      emailHash: 'email-hash',
      token: 'old-hashed-token',
      customerEntityId: null,
      personEntityId,
      roleIdsJson: ['old-role'],
      invitedByUserId: null,
      invitedByCustomerUserId: null,
      displayName: 'Old Name',
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      cancelledAt: null,
    } as unknown as CustomerUserInvitation

    ;(mockEm.findOne as jest.Mock).mockImplementation(async (entity: unknown) => {
      if (entity === CustomerUserInvitation) return existing
      return null
    })

    const result = await service.createInvitation(
      'old@example.com',
      { tenantId, organizationId },
      { roleIds, customerEntityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', invitedByCustomerUserId: 'portal-user-1' },
    )

    expect(result.reused).toBe(true)
    expect(existing.personEntityId).toBe(personEntityId)
    expect(existing.displayName).toBe('Old Name')
    expect(existing.customerEntityId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect(result.rollbackState?.personEntityId).toBe(personEntityId)
    expect(result.rollbackState?.displayName).toBe('Old Name')
  })

  it('inserts a new invitation row when no pending invitation exists', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(null)

    const personEntityId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const result = await service.createInvitation(
      'fresh@example.com',
      { tenantId, organizationId },
      { roleIds, personEntityId, invitedByUserId: 'inviter-2', displayName: 'Fresh' },
    )

    const invitationCreates = (mockEm.create as jest.Mock).mock.calls.filter(
      (call) => call[0] === CustomerUserInvitation,
    )
    expect(invitationCreates).toHaveLength(1)
    expect(invitationCreates[0][1]).toMatchObject({
      tenantId,
      organizationId,
      email: 'fresh@example.com',
      emailHash: 'email-hash',
      token: 'hashed-token',
      personEntityId,
      roleIdsJson: roleIds,
    })
    expect(mockEm.persist).toHaveBeenCalled()
    expect(result.rawToken).toBe('raw-token')
    expect(result.reused).toBe(false)
    expect(result.rollbackState).toBeNull()
  })
})

describe('CustomerInvitationService.rollbackInvitation', () => {
  it('hard-deletes the invitation and flushes the removal', async () => {
    const flush = jest.fn(async () => undefined)
    const mockEm = { remove: jest.fn(() => mockEm), flush } as unknown as EntityManager
    const service = new CustomerInvitationService(mockEm)
    const invitation = { id: 'inv-roll' } as unknown as CustomerUserInvitation

    await service.rollbackInvitation(invitation, null)

    expect(mockEm.remove).toHaveBeenCalledWith(invitation)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('restores the prior state of a reused invitation', async () => {
    const flush = jest.fn(async () => undefined)
    const mockEm = { remove: jest.fn(), flush } as unknown as EntityManager
    const service = new CustomerInvitationService(mockEm)
    const invitation = {
      email: 'new@example.com',
      token: 'new-token',
      customerEntityId: 'new-customer',
      personEntityId: 'new-person',
      roleIdsJson: ['new-role'],
      invitedByUserId: 'new-user',
      invitedByCustomerUserId: null,
      displayName: 'New Name',
      expiresAt: new Date('2026-08-05T00:00:00.000Z'),
    } as unknown as CustomerUserInvitation
    const rollbackState = {
      email: 'old@example.com',
      token: 'old-token',
      customerEntityId: null,
      personEntityId: null,
      roleIdsJson: ['old-role'],
      invitedByUserId: null,
      invitedByCustomerUserId: 'old-customer-user',
      displayName: 'Old Name',
      expiresAt: new Date('2026-08-04T00:00:00.000Z'),
    }

    await service.rollbackInvitation(invitation, rollbackState)

    expect(invitation).toMatchObject(rollbackState)
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('isCustomerInvitationEmailConflictError — bundle-boundary safety', () => {
  it('recognises an error thrown by this module', () => {
    expect(isCustomerInvitationEmailConflictError(new CustomerInvitationEmailConflictError('a@b.test'))).toBe(true)
  })

  it('recognises an equivalent error thrown by a duplicated copy of this module', () => {
    // The accept route resolves the service through DI and is bundled into a
    // different chunk, so its `CustomerInvitationEmailConflictError` class is not
    // the same object as this one and `instanceof` is false — which silently sent
    // the 409 back to a raw 500. The Symbol.for marker is what survives that.
    const duplicateModuleError = Object.assign(new Error('[internal] An account with this email address already exists'), {
      name: 'CustomerInvitationEmailConflictError',
      email: 'a@b.test',
      [Symbol.for('@open-mercato/CustomerInvitationEmailConflictError')]: true,
    })

    expect(duplicateModuleError instanceof CustomerInvitationEmailConflictError).toBe(false)
    expect(isCustomerInvitationEmailConflictError(duplicateModuleError)).toBe(true)
  })

  it('does not claim unrelated errors', () => {
    expect(isCustomerInvitationEmailConflictError(new Error('boom'))).toBe(false)
    expect(isCustomerInvitationEmailConflictError(null)).toBe(false)
    expect(isCustomerInvitationEmailConflictError('nope')).toBe(false)
  })
})
