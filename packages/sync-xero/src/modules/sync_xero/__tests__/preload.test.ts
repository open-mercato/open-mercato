import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { loadCompanySnapshots, loadXeroRunIndex } from '../lib/contacts/preload'

const mockFindWithDecryption = jest.fn()
const mockLoadCustomFieldValues = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldValues: (...args: unknown[]) => mockLoadCustomFieldValues(...args),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const em = {} as EntityManager

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockLoadCustomFieldValues.mockReset()
})

describe('loadXeroRunIndex', () => {
  it('reads the organization\'s sync_xero Company mappings once and grows with every won claim', async () => {
    mockFindWithDecryption.mockResolvedValue([{ externalId: 'org:c1', internalEntityId: 'e1' }])

    const index = await loadXeroRunIndex(em, scope)

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      SyncExternalIdMapping,
      { integrationId: 'sync_xero', internalEntityType: 'customers.company', organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      {},
      scope,
    )
    expect(index.lookup('org:c1')).toBe('e1')
    expect(index.isMapped('e1')).toBe(true)
    expect(index.lookup('org:c2')).toBeNull()
    index.add('org:c2', 'e2')
    expect(index.lookup('org:c2')).toBe('e2')
    expect(index.isMapped('e2')).toBe(true)
  })
})

describe('loadCompanySnapshots', () => {
  it('reads Companies, profiles and custom fields in three calls whatever the number of ids', async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `e${index}`)
    mockFindWithDecryption.mockImplementation(async (_em, entity, where: Record<string, unknown>) => {
      if (entity === CustomerEntity) {
        expect(where).toMatchObject({ organizationId: scope.organizationId, tenantId: scope.tenantId, kind: 'company', deletedAt: null })
        return (where.id as { $in: string[] }).$in.filter((id) => id !== 'e1').map((id) => ({
          id,
          displayName: `Company ${id}`,
          primaryEmail: null,
          primaryPhone: '+44 20 7946 0000',
          status: id === 'e2' ? 'archived' : 'active',
          isActive: id !== 'e2',
        }))
      }
      if (entity === CustomerCompanyProfile) {
        return (where.entity as { $in: string[] }).$in
          .filter((id) => id !== 'e3')
          .map((id) => ({ id: `p-${id}`, entity: { id }, legalName: `Legal ${id}`, websiteUrl: null }))
      }
      throw new Error(`[internal] unexpected entity ${String(entity)}`)
    })
    mockLoadCustomFieldValues.mockResolvedValue({ 'p-e0': { cf_xero_contact_id: 'org:c0', cf_xero_tax_number: 'GB 1' } })

    const snapshots = await loadCompanySnapshots(em, scope, [...ids, 'e0'])

    expect(mockFindWithDecryption).toHaveBeenCalledTimes(2)
    expect(mockLoadCustomFieldValues).toHaveBeenCalledTimes(1)
    expect(mockLoadCustomFieldValues.mock.calls[0][0]).toMatchObject({ entityId: 'customers:customer_company_profile', tenantFallbacks: [scope.tenantId] })
    expect(snapshots.size).toBe(999)
    expect(snapshots.has('e1')).toBe(false)
    expect(snapshots.get('e0')).toEqual({
      entityId: 'e0',
      displayName: 'Company e0',
      legalName: 'Legal e0',
      primaryEmail: null,
      primaryPhone: '+44 20 7946 0000',
      websiteUrl: null,
      status: 'active',
      isActive: true,
      custom: { xero_contact_id: 'org:c0', xero_tax_number: 'GB 1' },
    })
    expect(snapshots.get('e2')).toMatchObject({ status: 'archived', isActive: false })
    expect(snapshots.get('e3')).toMatchObject({ legalName: null, custom: {} })
  })

  it('makes no query for a page without mapped Contacts, and stops after the Companies when none is left', async () => {
    await expect(loadCompanySnapshots(em, scope, [])).resolves.toEqual(new Map())
    expect(mockFindWithDecryption).not.toHaveBeenCalled()

    mockFindWithDecryption.mockResolvedValue([])
    await expect(loadCompanySnapshots(em, scope, ['gone'])).resolves.toEqual(new Map())
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockLoadCustomFieldValues).not.toHaveBeenCalled()
  })
})
