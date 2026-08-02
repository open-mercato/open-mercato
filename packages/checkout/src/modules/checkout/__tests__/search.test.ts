import searchConfig from '../search'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'

describe('checkout search configuration', () => {
  it('indexes the encrypted transaction fields used by the list API', async () => {
    const transaction = searchConfig.entities.find((entry) => entry.entityId === CHECKOUT_ENTITY_IDS.transaction)
    expect(transaction?.fieldPolicy?.searchable).toEqual(['email', 'firstName', 'lastName'])

    const source = await transaction?.buildSource?.({
      record: { email: 'buyer@example.test', firstName: 'Ada', lastName: 'Lovelace' },
      customFields: {},
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(source?.fields).toMatchObject({
      email: 'buyer@example.test',
      first_name: 'Ada',
      last_name: 'Lovelace',
    })
  })
})
