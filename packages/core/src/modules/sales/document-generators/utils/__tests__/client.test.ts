import { resolveClientAddress, resolveClientName } from '../client'

describe('sales document client helpers', () => {
  it('resolveClientName prefers display name then company and contact names', () => {
    expect(resolveClientName({ customer: { displayName: 'Acme' } })).toBe('Acme')
    expect(resolveClientName({ customer: { companyProfile: { brandName: 'Brand' } } })).toBe('Brand')
    expect(resolveClientName({ contact: { firstName: 'Ann', lastName: 'Lee' } })).toBe('Ann Lee')
    expect(resolveClientName(null)).toBe('')
  })

  it('resolveClientAddress joins the available parts', () => {
    expect(
      resolveClientAddress({
        addressLine1: 'Main St',
        buildingNumber: '5',
        flatNumber: '2',
        postalCode: '00-001',
        city: 'Warsaw',
        country: 'PL',
      }),
    ).toBe('Main St 5/2, 00-001 Warsaw, PL')
    expect(resolveClientAddress({})).toBeUndefined()
    expect(resolveClientAddress(null)).toBeUndefined()
  })
})
