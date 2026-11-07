import { diffAddress, mapXeroAddresses, toCountryCode, XERO_ADDRESS_PURPOSE } from '../lib/contacts/addresses'
import type { XeroAddress, XeroContact } from '../lib/contacts/contact'

function contactWith(addresses: XeroAddress[]): XeroContact {
  return { ContactID: 'c1', Name: 'Acme Ltd', Addresses: addresses }
}

describe('mapXeroAddresses — App Spec § 6.2a Addresses', () => {
  it('maps one address per Xero type that has an address line, with the first line and the rest joined', () => {
    const mapped = mapXeroAddresses(
      contactWith([
        { AddressType: 'STREET', AddressLine1: ' ', AddressLine2: '1 High Street', AddressLine3: 'Unit 4', AddressLine4: 'Floor 2', City: 'London', Region: 'Greater London', PostalCode: 'SW1A 1AA', Country: 'United Kingdom' },
        { AddressType: 'POBOX', AddressLine1: 'PO Box 12', City: '', Country: 'gb' },
        { AddressType: 'DELIVERY', AddressLine1: 'Ignored' },
      ]),
    )

    expect(mapped).toEqual([
      { addressType: 'POBOX', values: { addressLine1: 'PO Box 12', country: 'GB' }, warnings: [] },
      {
        addressType: 'STREET',
        values: { addressLine1: '1 High Street', addressLine2: 'Unit 4, Floor 2', city: 'London', region: 'Greater London', postalCode: 'SW1A 1AA', country: 'GB' },
        warnings: [],
      },
    ])
    expect(XERO_ADDRESS_PURPOSE).toEqual({ POBOX: 'billing', STREET: 'office' })
  })

  it('writes nothing for an address without an address line', () => {
    expect(mapXeroAddresses(contactWith([{ AddressType: 'STREET', AddressLine1: '', City: 'London', Country: 'GB' }]))).toEqual([])
    expect(mapXeroAddresses({ ContactID: 'c1', Addresses: null })).toEqual([])
  })

  it('truncates lines, city and region, and leaves out a postal code over 30 characters', () => {
    const [address] = mapXeroAddresses(
      contactWith([{ AddressType: 'STREET', AddressLine1: 'L'.repeat(310), City: 'C'.repeat(160), Region: 'R'.repeat(151), PostalCode: '9'.repeat(31) }]),
    )
    expect(address.values.addressLine1).toHaveLength(300)
    expect(address.values.city).toHaveLength(150)
    expect(address.values.region).toHaveLength(150)
    expect(address.values.postalCode).toBeUndefined()
    expect(address.warnings).toEqual([
      { code: 'xero.value_truncated', field: 'addressLine1' },
      { code: 'xero.value_truncated', field: 'city' },
      { code: 'xero.value_truncated', field: 'region' },
      { code: 'xero.value_left_out', field: 'postalCode' },
    ])
  })

  it('converts a country name or code to its ISO code and keeps an unknown country as written, with a warning', () => {
    expect(toCountryCode('United Kingdom')).toBe('GB')
    expect(toCountryCode(' pl ')).toBe('PL')
    expect(toCountryCode('Narnia')).toBeNull()
    const [address] = mapXeroAddresses(contactWith([{ AddressType: 'POBOX', AddressLine1: 'PO Box 1', Country: 'Narnia' }]))
    expect(address.values.country).toBe('Narnia')
    expect(address.warnings).toEqual([{ code: 'xero.address_country_unrecognised', field: 'country' }])
  })
})

describe('diffAddress', () => {
  const [mapped] = mapXeroAddresses(contactWith([{ AddressType: 'STREET', AddressLine1: '1 High Street', City: 'London', Country: 'GB' }]))

  it('answers null when every Xero value matches and only the differing columns otherwise', () => {
    expect(diffAddress(mapped, { id: 'a1', entityId: 'e1', addressLine1: '1 High Street', city: 'London', country: 'GB', postalCode: 'kept by the user' })).toBeNull()
    expect(diffAddress(mapped, { id: 'a1', entityId: 'e1', addressLine1: '1 High Street', city: 'Leeds', country: null })).toEqual({ city: 'London', country: 'GB' })
  })
})
