import setup from '../setup'
import { seedDraftStore } from '../lib/seedDraftStore'

jest.mock('../lib/seedDraftStore', () => ({
  seedDraftStore: jest.fn(async () => ({ status: 'created', storeId: 'store-1' })),
}))

const mockedSeed = seedDraftStore as jest.Mock

describe('ecommerce setup', () => {
  beforeEach(() => mockedSeed.mockClear())

  it('seeds the draft store when a tenant is created', async () => {
    const em = {}
    await setup.onTenantCreated?.({ em: em as never, tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(mockedSeed).toHaveBeenCalledTimes(1)
    expect(mockedSeed).toHaveBeenCalledWith(em, { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('keeps the default role features', () => {
    expect(setup.defaultRoleFeatures).toEqual({
      superadmin: ['ecommerce.*'],
      admin: ['ecommerce.*'],
      employee: ['ecommerce.stores.view'],
    })
  })
})
