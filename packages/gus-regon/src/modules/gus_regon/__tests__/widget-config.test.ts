import { applyFieldMap, buildWidgetMetadata, resolveCompanyValue } from '../lib/widget-config'
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

describe('resolveCompanyValue', () => {
  it('composes the street line from street, building and flat number', () => {
    expect(resolveCompanyValue(company, 'streetLine')).toBe('ul. Test-Krucza 53')
    expect(resolveCompanyValue({ ...company, flatNumber: '2' }, 'streetLine')).toBe('ul. Test-Krucza 53/2')
    expect(resolveCompanyValue({ ...company, street: null }, 'streetLine')).toBe('Warszawa 53')
    expect(resolveCompanyValue({ ...company, street: null, city: null }, 'streetLine')).toBeNull()
  })

  it('returns plain fields and the country', () => {
    expect(resolveCompanyValue(company, 'regon')).toBe('140182840')
    expect(resolveCompanyValue(company, 'flatNumber')).toBeNull()
    expect(resolveCompanyValue(company, 'country')).toBe('PL')
  })
})

describe('applyFieldMap', () => {
  const map = { name: ['name', 'legalName'], regon: 'regon', streetLine: 'street', postalCode: 'postalCode', city: 'city', flatNumber: 'flat' }

  it('fills empty mapped fields and reports them', () => {
    const { values, filled } = applyFieldMap({ name: '', taxId: '5252344078' }, company, map)
    expect(values).toMatchObject({
      name: company.name,
      legalName: company.name,
      regon: '140182840',
      street: 'ul. Test-Krucza 53',
      postalCode: '00-113',
      city: 'Warszawa',
      taxId: '5252344078',
    })
    expect(filled).toEqual(['name', 'legalName', 'regon', 'street', 'postalCode', 'city'])
  })

  it('skips GUS values that are empty and never overwrites typed values', () => {
    const input = { name: 'Google', city: 'Kraków' }
    const { values, filled } = applyFieldMap(input, company, map)
    expect(values.name).toBe('Google')
    expect(values.city).toBe('Kraków')
    expect(values).not.toHaveProperty('flat')
    expect(filled).not.toContain('name')
    expect(filled).not.toContain('city')
    expect(input).toEqual({ name: 'Google', city: 'Kraków' })
  })
})

describe('buildWidgetMetadata', () => {
  it('builds metadata with the lookup feature and required modules', () => {
    expect(buildWidgetMetadata({ id: 'purchasing.injection.gus-supplier', fields: { name: 'name' } })).toMatchObject({
      id: 'purchasing.injection.gus-supplier',
      features: ['gus_regon.lookup'],
      requiredModules: ['gus_regon', 'integrations'],
      priority: 50,
    })
  })

  it('merges extra required modules and custom features', () => {
    const metadata = buildWidgetMetadata({
      id: 'gus_regon.injection.company-lookup',
      apply: (values) => ({ values, filled: [] }),
      requiredModules: ['customers', 'integrations'],
      features: ['gus_regon.lookup', 'customers.companies.manage'],
    })
    expect(metadata.requiredModules).toEqual(['gus_regon', 'integrations', 'customers'])
    expect(metadata.features).toEqual(['gus_regon.lookup', 'customers.companies.manage'])
  })

  it('rejects invalid ids and missing or conflicting mappings', () => {
    expect(() => buildWidgetMetadata({ id: 'no-module-prefix', fields: { name: 'name' } })).toThrow(/invalid widget id/)
    expect(() => buildWidgetMetadata({ id: 'purchasing.injection.gus' })).toThrow(/needs either/)
    expect(() =>
      buildWidgetMetadata({ id: 'purchasing.injection.gus', fields: { name: 'name' }, apply: (values) => ({ values, filled: [] }) }),
    ).toThrow(/must not define both/)
    expect(() =>
      buildWidgetMetadata({ id: 'purchasing.injection.gus', fields: { name: 'name' }, gate: 'always' as unknown as 'lookup' }),
    ).toThrow(/unknown gate/)
  })
})
