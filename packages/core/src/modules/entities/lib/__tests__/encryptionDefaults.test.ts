import { DEFAULT_ENCRYPTION_MAPS } from '../encryptionDefaults'

describe('DEFAULT_ENCRYPTION_MAPS', () => {
  it('registers checkout link, template, and transaction defaults', () => {
    const template = DEFAULT_ENCRYPTION_MAPS.find((entry) => entry.entityId === 'checkout:checkout_link_template')
    const link = DEFAULT_ENCRYPTION_MAPS.find((entry) => entry.entityId === 'checkout:checkout_link')
    const transaction = DEFAULT_ENCRYPTION_MAPS.find((entry) => entry.entityId === 'checkout:checkout_transaction')

    expect(template?.fields).toEqual([{ field: 'gateway_settings' }])
    expect(link?.fields).toEqual([{ field: 'gateway_settings' }])
    expect(transaction?.fields).toEqual(expect.arrayContaining([
      { field: 'customer_data' },
      { field: 'email' },
      { field: 'accepted_legal_consents' },
      { field: 'ip_address' },
    ]))
  })
})
