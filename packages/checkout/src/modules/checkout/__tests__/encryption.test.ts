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

  // Release 5, Step 2.12 (B.1, §13 — C14's security minimum).
  it('registers the checkout session PII fields (email, phone, shipping/billing address)', () => {
    const session = defaultEncryptionMaps.find((entry) => entry.entityId === 'checkout:checkout_session')
    expect(session?.fields).toEqual([
      { field: 'email' },
      { field: 'phone' },
      { field: 'shipping_address' },
      { field: 'billing_address' },
    ])
  })
})
