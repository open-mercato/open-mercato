import { applyCompanyToCustomersCompanyForm, buildAddressDraft, toTitleCase } from '../lib/mapping'
import type { GusCompany } from '../lib/types'

const company: GusCompany = {
  nip: '5252344078',
  regon: '140182840',
  name: 'GOOGLE POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  street: 'ul. Test-Krucza',
  buildingNumber: '53',
  flatNumber: null,
  postalCode: '00-113',
  city: 'Warszawa',
  voivodeship: 'MAZOWIECKIE',
  county: 'm. st. Warszawa',
  commune: 'Śródmieście',
  type: 'P',
  endDate: null,
  country: 'PL',
}

describe('toTitleCase', () => {
  it('title-cases Polish voivodeship names', () => {
    expect(toTitleCase('MAZOWIECKIE')).toBe('Mazowieckie')
    expect(toTitleCase('WARMIŃSKO-MAZURSKIE')).toBe('Warmińsko-Mazurskie')
    expect(toTitleCase('ŚLĄSKIE')).toBe('Śląskie')
    expect(toTitleCase(null)).toBeNull()
  })
})

describe('buildAddressDraft', () => {
  it('builds a primary address in the customers address shape', () => {
    const draft = buildAddressDraft(company, 'Siedziba (GUS)')
    expect(draft).toMatchObject({
      name: 'Siedziba (GUS)',
      companyName: company.name,
      addressLine1: 'ul. Test-Krucza',
      buildingNumber: '53',
      city: 'Warszawa',
      region: 'Mazowieckie',
      postalCode: '00-113',
      country: 'PL',
      isPrimary: true,
    })
    expect(draft?.id).toEqual(expect.any(String))
    expect(draft).not.toHaveProperty('flatNumber')
  })

  it('falls back to the city when GUS has no street (villages)', () => {
    expect(buildAddressDraft({ ...company, street: null })?.addressLine1).toBe('Warszawa')
  })

  it('returns null when there is no street and no city', () => {
    expect(buildAddressDraft({ ...company, street: null, city: null })).toBeNull()
  })
})

describe('applyCompanyToCustomersCompanyForm', () => {
  it('fills empty name fields and adds a primary address on the create form', () => {
    const { values, filled } = applyCompanyToCustomersCompanyForm({ addresses: [] }, company)
    expect(filled).toEqual(['legalName', 'displayName', 'addresses'])
    expect(values.legalName).toBe(company.name)
    expect(values.displayName).toBe(company.name)
    expect(values.addresses).toHaveLength(1)
  })

  it('never overwrites operator-typed values', () => {
    const input = { displayName: 'Google', legalName: '  ', addresses: [{ id: 'a1', addressLine1: 'Existing 1' }] }
    const { values, filled } = applyCompanyToCustomersCompanyForm(input, company)
    expect(filled).toEqual(['legalName'])
    expect(values.displayName).toBe('Google')
    expect(values.addresses).toBe(input.addresses)
  })

  it('does not touch addresses on forms that do not manage them (edit form)', () => {
    const { values, filled } = applyCompanyToCustomersCompanyForm({ displayName: '' }, company)
    expect(filled).toEqual(['legalName', 'displayName'])
    expect(values).not.toHaveProperty('addresses')
  })

  it('does not mutate the input object', () => {
    const input = { addresses: [] as unknown[] }
    applyCompanyToCustomersCompanyForm(input, company)
    expect(input).toEqual({ addresses: [] })
  })

  it('fills nothing when GUS has no name and the form has addresses', () => {
    const { filled } = applyCompanyToCustomersCompanyForm({ addresses: [{ id: 'x' }] }, { ...company, name: null })
    expect(filled).toEqual([])
  })
})
