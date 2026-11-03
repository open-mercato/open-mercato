import { normalizeAddressDraft } from '../normalizeAddressDraft'
const draft = {
  name: 'Fixture GmbH',
  purpose: '',
  companyName: '',
  addressLine1: 'Teststraße 5',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: 'Berlin',
  region: '',
  postalCode: '10115',
  country: 'DE',
  isPrimary: false,
}

describe('SalesDocumentForm — the create page keeps every key the editor writes', () => {
  it('carries the tax id, its scheme and the phone into the snapshot', () => {
    const normalized = normalizeAddressDraft({
      ...draft,
      taxId: 'DE811907980',
      taxIdType: 'eu_vat',
      phone: '+49 30 123456',
    })

    expect(normalized).toMatchObject({
      taxId: 'DE811907980',
      taxIdType: 'eu_vat',
      phone: '+49 30 123456',
    })
  })

  it('still carries the postal fields beside them', () => {
    const normalized = normalizeAddressDraft({ ...draft, taxId: 'DE811907980' })

    expect(normalized).toMatchObject({ addressLine1: 'Teststraße 5', city: 'Berlin', country: 'DE' })
  })

  it('omits a field left blank rather than writing an empty string', () => {
    const normalized = normalizeAddressDraft({ ...draft, taxId: '', taxIdType: '', phone: '   ' })

    expect(normalized).not.toHaveProperty('taxId')
    expect(normalized).not.toHaveProperty('taxIdType')
    expect(normalized).not.toHaveProperty('phone')
  })

  it('trims what it does carry, so a stray space does not become part of an identifier', () => {
    const normalized = normalizeAddressDraft({ ...draft, taxId: '  DE811907980  ' })

    expect(normalized).toMatchObject({ taxId: 'DE811907980' })
  })

  it('returns null for no draft at all, so the caller sends no snapshot', () => {
    expect(normalizeAddressDraft(null)).toBeNull()
    expect(normalizeAddressDraft(undefined)).toBeNull()
  })
})
