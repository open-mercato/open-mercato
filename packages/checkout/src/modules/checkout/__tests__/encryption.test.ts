import { defaultEncryptionMaps } from '../encryption'

describe('checkout defaultEncryptionMaps', () => {
  it('registers checkout link, template, and transaction defaults', () => {
    const template = defaultEncryptionMaps.find((entry) => entry.entityId === 'checkout:checkout_link_template')
    const link = defaultEncryptionMaps.find((entry) => entry.entityId === 'checkout:checkout_link')
    const transaction = defaultEncryptionMaps.find((entry) => entry.entityId === 'checkout:checkout_transaction')

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
