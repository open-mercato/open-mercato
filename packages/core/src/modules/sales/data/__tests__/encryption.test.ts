import { defaultEncryptionMaps } from '../../encryption'

describe('sales defaultEncryptionMaps', () => {
  it('encrypts sales_channel contact and address PII fields', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'sales:sales_channel')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'contact_email' },
      { field: 'contact_phone' },
      { field: 'address_line1' },
      { field: 'address_line2' },
      { field: 'city' },
      { field: 'region' },
      { field: 'postal_code' },
      { field: 'country' },
    ]))
  })

  it('keeps existing snapshot encryption coverage on sales_order', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'sales:sales_order')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'customer_snapshot' },
      { field: 'billing_address_snapshot' },
      { field: 'shipping_address_snapshot' },
    ]))
  })
})
