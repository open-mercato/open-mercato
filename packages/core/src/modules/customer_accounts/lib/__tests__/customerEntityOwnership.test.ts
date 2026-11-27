import { EntityMetadata, MetadataStorage } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isOwnedCompanyEntity, isOwnedPersonEntity, resolveOwnedCompanyForPerson } from '../customerEntityOwnership'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

describe('customer entity ownership and CRM metadata', () => {
  const scope = { tenantId: 'tenant-id', organizationId: 'organization-id' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not look up ownership when the customer entity is unregistered', async () => {
    const em = { getMetadata: () => new MetadataStorage() } as unknown as EntityManager

    await expect(isOwnedCompanyEntity(em, 'company-id', scope)).resolves.toBe(false)
    await expect(isOwnedPersonEntity(em, 'person-id', scope)).resolves.toBe(false)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('does not query a person profile to recover a company when it is unregistered', async () => {
    const findOne = jest.fn()
    const em = { getMetadata: () => new MetadataStorage(), findOne } as unknown as EntityManager

    await expect(resolveOwnedCompanyForPerson(em, 'person-id', scope)).resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('does not use unrelated same-name entities as CRM metadata', async () => {
    const metadata = new MetadataStorage()
    const otherEntities = [
      class CustomerEntity { static entityName = 'unrelated.CustomerEntity' },
      class CustomerPersonProfile { static entityName = 'unrelated.CustomerPersonProfile' },
    ]
    for (const entity of otherEntities) {
      metadata.set(entity, new EntityMetadata({ class: entity, className: entity.name }))
    }
    const findOne = jest.fn()
    const em = { getMetadata: () => metadata, findOne } as unknown as EntityManager

    await expect(isOwnedCompanyEntity(em, 'company-id', scope)).resolves.toBe(false)
    await expect(resolveOwnedCompanyForPerson(em, 'person-id', scope)).resolves.toBeNull()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('recovers the scoped company with same-name app entity overrides registered', async () => {
    const metadata = new MetadataStorage()
    const entityOverrides = [
      class CustomerEntity { static entityName = 'customers.CustomerEntity' },
      class CustomerPersonProfile { static entityName = 'customers.CustomerPersonProfile' },
    ]
    for (const entity of entityOverrides) {
      metadata.set(entity, new EntityMetadata({ class: entity, className: entity.name }))
    }
    const companyId = 'company-id'
    const personId = 'person-id'
    const findOne = jest.fn().mockResolvedValue({ company: companyId })
    const em = { getMetadata: () => metadata, findOne } as unknown as EntityManager
    jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ id: companyId })

    await expect(resolveOwnedCompanyForPerson(em, personId, scope)).resolves.toBe(companyId)
    expect(findOne).toHaveBeenCalledWith(CustomerPersonProfile, { entity: personId, ...scope })
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      CustomerEntity,
      { id: companyId, kind: 'company', deletedAt: null, ...scope },
      undefined,
      scope,
    )
  })
})
