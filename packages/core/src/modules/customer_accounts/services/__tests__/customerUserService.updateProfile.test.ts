/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

type TestUser = Pick<CustomerUser, 'id' | 'tenantId' | 'organizationId' | 'displayName'>

function buildUser(): TestUser {
  return {
    id: 'ccb0d0d6-0f19-4f0e-9ad4-2a4a3c2a6a11',
    tenantId: 'e4b0a0f2-4f6e-4a51-9d9f-6a2c9d1b3f77',
    organizationId: '6f2f4b17-7d2f-4b0e-9e08-3b1c1d2f4a55',
    displayName: 'Old Name',
  }
}

function buildEm(overrides: Partial<Record<'flush' | 'nativeUpdate', jest.Mock>> = {}) {
  return {
    flush: overrides.flush ?? jest.fn(async () => undefined),
    nativeUpdate: overrides.nativeUpdate ?? jest.fn(async () => 1),
  }
}

describe('CustomerUserService.updateProfile', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('persists display_name through the managed entity so the encryption subscriber encrypts it (#3837)', async () => {
    const user = buildUser()
    const managed = { ...user } as CustomerUser
    findOneWithDecryptionMock.mockResolvedValue(managed as never)
    const em = buildEm()
    const service = new CustomerUserService(em as unknown as EntityManager)

    await service.updateProfile(user as CustomerUser, { displayName: 'New Name' })

    expect(managed.displayName).toBe('New Name')
    expect(em.flush).toHaveBeenCalledTimes(1)
    // `nativeUpdate` issues raw SQL and skips the flush hooks the tenant-encryption
    // subscriber depends on, which is exactly how the plaintext write happened.
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('loads the managed entity within the caller tenant and organization scope', async () => {
    const user = buildUser()
    findOneWithDecryptionMock.mockResolvedValue({ ...user } as never)
    const em = buildEm()
    const service = new CustomerUserService(em as unknown as EntityManager)

    await service.updateProfile(user as CustomerUser, { displayName: 'New Name' })

    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
    const [, entity, where, , scope] = findOneWithDecryptionMock.mock.calls[0]
    expect(entity).toBe(CustomerUser)
    expect(where).toMatchObject({ id: user.id, tenantId: user.tenantId, deletedAt: null })
    expect(scope).toEqual({ tenantId: user.tenantId, organizationId: user.organizationId })
  })

  it('mirrors the saved value onto the entity the caller passed in', async () => {
    const user = buildUser()
    findOneWithDecryptionMock.mockResolvedValue({ ...user } as never)
    const em = buildEm()
    const service = new CustomerUserService(em as unknown as EntityManager)

    await service.updateProfile(user as CustomerUser, { displayName: 'New Name' })

    expect(user.displayName).toBe('New Name')
  })

  it('does nothing when no display name is supplied', async () => {
    const user = buildUser()
    const em = buildEm()
    const service = new CustomerUserService(em as unknown as EntityManager)

    await service.updateProfile(user as CustomerUser, {})

    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('leaves the caller entity untouched when the row is gone', async () => {
    const user = buildUser()
    findOneWithDecryptionMock.mockResolvedValue(null as never)
    const em = buildEm()
    const service = new CustomerUserService(em as unknown as EntityManager)

    await service.updateProfile(user as CustomerUser, { displayName: 'New Name' })

    expect(em.flush).not.toHaveBeenCalled()
    expect(user.displayName).toBe('Old Name')
  })
})
