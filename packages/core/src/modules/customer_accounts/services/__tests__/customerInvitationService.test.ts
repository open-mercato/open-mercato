/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import {
  CustomerRole,
  CustomerUserInvitation,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator', () => ({
  generateSecureToken: jest.fn(() => 'raw-token'),
  hashToken: jest.fn(() => 'hashed-token'),
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  hashForLookup: jest.fn(() => 'email-hash'),
}))

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed-${value}`),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: any, entity: any, where: any, options?: any) => em.find(entity, where, options),
  findOneWithDecryption: (em: any, entity: any, where: any, options?: any) => em.findOne(entity, where, options),
  findAndCountWithDecryption: (em: any, entity: any, where: any, options?: any) => em.findAndCount(entity, where, options),
}))

describe('CustomerInvitationService.acceptInvitation — role lookup batching', () => {
  const roleIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'flush'>>
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
      deletedAt: null,
    })
    expect(mockEm.findOne).not.toHaveBeenCalledWith(CustomerRole, expect.anything())

    const linkCreates = (mockEm.create as jest.Mock).mock.calls.filter((call) => call[0] === CustomerUserRole)
    expect(linkCreates).toHaveLength(roleIds.length)
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

    const beforeExpiresAt = existing.expiresAt.getTime()
    const result = await service.createInvitation(
      ' New@Example.COM ',
      { tenantId, organizationId },
      { roleIds, invitedByUserId: 'inviter-1', displayName: 'Refreshed Name' },
    )

    expect(mockEm.create).not.toHaveBeenCalled()
    expect(result.invitation).toBe(existing)
    expect(result.rawToken).toBe('raw-token')
    expect(existing.email).toBe('new@example.com')
    expect(existing.token).toBe('hashed-token')
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

  it('inserts a new invitation row when no pending invitation exists', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(null)

    const result = await service.createInvitation(
      'fresh@example.com',
      { tenantId, organizationId },
      { roleIds, invitedByUserId: 'inviter-2', displayName: 'Fresh' },
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
      roleIdsJson: roleIds,
    })
    expect(mockEm.persist).toHaveBeenCalled()
    expect(result.rawToken).toBe('raw-token')
  })
})
