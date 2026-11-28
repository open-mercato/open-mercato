import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadEntityRecordScope } from '@open-mercato/shared/lib/db/recordScope'
import { CustomerEntity } from '../../data/entities'
import { findScopedCustomerCommandRecord } from '../shared'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/db/recordScope', () => ({ loadEntityRecordScope: jest.fn() }))

const lookup = jest.mocked(findOneWithDecryption)
const scopeLookup = jest.mocked(loadEntityRecordScope)
const context = {
  auth: { sub: 'actor', tenantId: 'tenant-home', orgId: 'organization-home' },
  organizationScope: {
    tenantId: 'tenant-home', selectedId: 'organization-home',
    allowedIds: ['organization-home'], filterIds: ['organization-home'],
  },
} as CommandRuntimeContext
const manager = {
  getMetadata: () => ({ get: () => ({ className: 'CustomerEntity' }) }),
  count: jest.fn(),
} as unknown as EntityManager

describe('scoped customer command denial responses', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    lookup.mockResolvedValue(null)
    scopeLookup.mockResolvedValue(null)
    jest.mocked(manager.count).mockResolvedValue(1)
  })

  it('hydrates only the authorized scope and avoids a second query on success', async () => {
    const entity = { id: 'customer', tenantId: 'tenant-home', organizationId: 'organization-home' }
    lookup.mockResolvedValue(entity)
    await expect(findScopedCustomerCommandRecord(manager, CustomerEntity, { id: 'customer' }, undefined, context))
      .resolves.toBe(entity)
    expect(lookup).toHaveBeenCalledWith(manager, CustomerEntity, expect.objectContaining({
      id: 'customer', tenantId: 'tenant-home', organizationId: 'organization-home',
    }), undefined, { tenantId: 'tenant-home', organizationId: 'organization-home' })
    expect(scopeLookup).not.toHaveBeenCalled()
  })

  it.each([
    { tenantId: 'tenant-home', organizationId: 'organization-other' },
    { tenantId: 'tenant-other', organizationId: 'organization-other' },
  ])('retains 403 for an existing record outside $tenantId / $organizationId without hydrating it', async (scope) => {
    scopeLookup.mockResolvedValue(scope)
    await expect(findScopedCustomerCommandRecord(manager, CustomerEntity, { id: 'customer' }, undefined, context))
      .rejects.toMatchObject({ status: 403 })
    expect(scopeLookup).toHaveBeenCalledWith(manager, 'CustomerEntity', 'customer')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][2]).toMatchObject({ tenantId: 'tenant-home', organizationId: 'organization-home' })
  })

  it('retains a missing result when the record does not exist', async () => {
    await expect(findScopedCustomerCommandRecord(manager, CustomerEntity, { id: 'missing' }, undefined, context))
      .resolves.toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('does not turn a deleted or otherwise filtered record in the same scope into forbidden', async () => {
    scopeLookup.mockResolvedValue({ tenantId: 'tenant-home', organizationId: 'organization-home' })
    await expect(findScopedCustomerCommandRecord(manager, CustomerEntity, { id: 'customer', deletedAt: null }, undefined, context))
      .resolves.toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('retains not-found for a deleted record outside the authorized scope', async () => {
    scopeLookup.mockResolvedValue({ tenantId: 'tenant-other', organizationId: 'organization-other' })
    jest.mocked(manager.count).mockResolvedValue(0)
    await expect(findScopedCustomerCommandRecord(manager, CustomerEntity, { id: 'customer', deletedAt: null }, undefined, context))
      .resolves.toBeNull()
    expect(manager.count).toHaveBeenCalledWith(CustomerEntity, {
      id: 'customer', deletedAt: null, tenantId: 'tenant-other', organizationId: 'organization-other',
    })
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
