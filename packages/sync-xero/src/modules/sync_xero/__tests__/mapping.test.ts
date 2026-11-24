import { parseXeroContact, type XeroContact } from '../lib/contacts/contact'
import { formatXeroPhone, mapXeroContactToCompany, normalizeXeroWebsite, type MappedXeroCompany } from '../lib/contacts/mapping'

function contact(fields: Partial<XeroContact>): XeroContact {
  return { ContactID: 'c0000000-0000-4000-8000-000000000001', Name: 'Acme Ltd', ContactStatus: 'ACTIVE', ...fields }
}

function mapped(fields: Partial<XeroContact>): MappedXeroCompany {
  const result = mapXeroContactToCompany(contact(fields))
  if (!result.ok) throw new Error('[internal] expected a mapped Contact')
  return result.company
}

describe('parseXeroContact', () => {
  it('keeps the fields the run reads and rejects a record without a ContactID', () => {
    expect(parseXeroContact({ ContactID: 'c1', Name: 'Acme', Unrelated: 1 })).toMatchObject({ ContactID: 'c1', Name: 'Acme', Unrelated: 1 })
    expect(parseXeroContact({ Name: 'Acme' })).toBeNull()
    expect(parseXeroContact({ ContactID: 'c1', Name: 42 })).toBeNull()
  })

  it('reads an optional TaxNumberType and tolerates a missing or unknown one', () => {
    expect(parseXeroContact({ ContactID: 'c1', TaxNumberType: 'SSN' })).toMatchObject({ TaxNumberType: 'SSN' })
    expect(parseXeroContact({ ContactID: 'c1', TaxNumberType: 'SOMETHING_NEW' })).toMatchObject({ TaxNumberType: 'SOMETHING_NEW' })
    expect(parseXeroContact({ ContactID: 'c1', TaxNumberType: null })).toMatchObject({ ContactID: 'c1' })
    expect(parseXeroContact({ ContactID: 'c1' })).toMatchObject({ ContactID: 'c1' })
  })
})

describe('mapXeroContactToCompany — App Spec § 6.2a Company rows', () => {
  it('maps Name to displayName and legalName, and refuses a Contact without a name', () => {
    expect(mapped({ Name: '  Acme Ltd  ' })).toMatchObject({ displayName: 'Acme Ltd', legalName: 'Acme Ltd', warnings: [] })
    expect(mapXeroContactToCompany(contact({ Name: '   ' }))).toEqual({ ok: false, reason: 'name_missing' })
    expect(mapXeroContactToCompany(contact({ Name: null }))).toEqual({ ok: false, reason: 'name_missing' })
  })

  it('truncates a name over 200 characters and warns for both fields', () => {
    const company = mapped({ Name: 'A'.repeat(255) })
    expect(company.displayName).toHaveLength(200)
    expect(company.legalName).toHaveLength(200)
    expect(company.warnings).toEqual([
      { code: 'xero.value_truncated', field: 'displayName' },
      { code: 'xero.value_truncated', field: 'legalName' },
    ])
  })

  it('keeps a valid email and leaves out one OM rejects', () => {
    expect(mapped({ EmailAddress: ' billing@acme.example ' }).primaryEmail).toBe('billing@acme.example')
    const invalid = mapped({ EmailAddress: 'billing at acme' })
    expect(invalid.primaryEmail).toBeNull()
    expect(invalid.warnings).toEqual([{ code: 'xero.value_left_out', field: 'primaryEmail' }])
    expect(mapped({ EmailAddress: '' })).toMatchObject({ primaryEmail: null, warnings: [] })
  })

  it('takes the first non-blank phone of DEFAULT, MOBILE, DDI, OFFICE and never a fax', () => {
    const company = mapped({
      Phones: [
        { PhoneType: 'FAX', PhoneNumber: '7946 0999', PhoneAreaCode: '020', PhoneCountryCode: '44' },
        { PhoneType: 'DEFAULT', PhoneNumber: ' ', PhoneAreaCode: '', PhoneCountryCode: '' },
        { PhoneType: 'OFFICE', PhoneNumber: '7946 0002', PhoneAreaCode: '020', PhoneCountryCode: '44' },
        { PhoneType: 'MOBILE', PhoneNumber: '7700 900123', PhoneAreaCode: '', PhoneCountryCode: '+44' },
      ],
    })
    expect(company.primaryPhone).toBe('+44 7700 900123')
    expect(mapped({ Phones: [{ PhoneType: 'FAX', PhoneNumber: '7946 0999', PhoneCountryCode: '44' }] })).toMatchObject({ primaryPhone: null, warnings: [] })
  })

  it('formats the phone with the country code, drops the trunk 0 except for Italy, and leaves out a phone without a country code', () => {
    expect(formatXeroPhone({ PhoneNumber: '7946 0000', PhoneAreaCode: '020', PhoneCountryCode: '(44)' })).toBe('+44 20 7946 0000')
    expect(formatXeroPhone({ PhoneNumber: '1234567', PhoneAreaCode: '06', PhoneCountryCode: '39' })).toBe('+39 06 1234567')
    expect(formatXeroPhone({ PhoneNumber: '555 0100', PhoneAreaCode: '', PhoneCountryCode: '1' })).toBe('+1 555 0100')
    expect(formatXeroPhone({ PhoneNumber: '7946 0000', PhoneAreaCode: '020', PhoneCountryCode: '' })).toBeNull()

    const withoutCountry = mapped({ Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '7946 0000', PhoneAreaCode: '020' }] })
    expect(withoutCountry.primaryPhone).toBeNull()
    expect(withoutCountry.warnings).toEqual([{ code: 'xero.value_left_out', field: 'primaryPhone' }])
    const tooShort = mapped({ Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '12', PhoneCountryCode: '1' }] })
    expect(tooShort.warnings).toEqual([{ code: 'xero.value_left_out', field: 'primaryPhone' }])
  })

  it('adds https:// to a website without a scheme and leaves out one that is still not a URL', () => {
    expect(normalizeXeroWebsite('acme.example')).toBe('https://acme.example')
    expect(normalizeXeroWebsite('http://acme.example')).toBe('http://acme.example')
    expect(mapped({ Website: 'www.acme.example/about' }).websiteUrl).toBe('https://www.acme.example/about')
    const invalid = mapped({ Website: 'not a website' })
    expect(invalid.websiteUrl).toBeNull()
    expect(invalid.warnings).toEqual([{ code: 'xero.value_left_out', field: 'websiteUrl' }])
  })

  it('leaves out a website whose scheme is not http or https', () => {
    for (const website of ['javascript://alert(1)', 'ftp://files.acme.example', 'data://text/plain,acme']) {
      const company = mapped({ Website: website })
      expect(company.websiteUrl).toBeNull()
      expect(company.warnings).toEqual([{ code: 'xero.value_left_out', field: 'websiteUrl' }])
    }
    expect(mapped({ Website: 'HTTPS://acme.example' }).websiteUrl).toBe('HTTPS://acme.example')
  })

  it('keeps the tax number as Xero holds it, never maps CompanyNumber, and reads the contact status', () => {
    const company = mapped({ TaxNumber: ' gb 123 456 ', CompanyNumber: '0123', ContactStatus: 'archived' })
    expect(company.taxNumber).toBe('gb 123 456')
    expect(company.contactStatus).toBe('ARCHIVED')
    expect(company).not.toHaveProperty('companyNumber')
    expect(mapped({ ContactStatus: 'SOMETHING_ELSE' }).contactStatus).toBeNull()
  })

  it('leaves out a tax number longer than the VAT ID allows and warns for taxId', () => {
    const company = mapped({ TaxNumber: 'GB'.padEnd(65, '1') })
    expect(company.taxNumber).toBeNull()
    expect(company.warnings).toEqual([{ code: 'xero.value_left_out', field: 'taxId' }])
    expect(mapped({ TaxNumber: 'GB'.padEnd(64, '1') }).warnings).toEqual([])
  })

  it('never maps a personal US tax number (SSN, ITIN, ATIN) to taxId, but maps an EIN, an untyped or an unknown type', () => {
    for (const type of ['SSN', 'ITIN', ' atin ']) {
      expect(mapped({ TaxNumber: '123-45-6789', TaxNumberType: type })).toMatchObject({ taxNumber: null, warnings: [] })
    }
    expect(mapped({ TaxNumber: '12-3456789', TaxNumberType: 'EIN' }).taxNumber).toBe('12-3456789')
    expect(mapped({ TaxNumber: 'GB 123' }).taxNumber).toBe('GB 123')
    expect(mapped({ TaxNumber: 'GB 123', TaxNumberType: null }).taxNumber).toBe('GB 123')
    expect(mapped({ TaxNumber: 'GB 123', TaxNumberType: 'SOMETHING_NEW' }).taxNumber).toBe('GB 123')
  })
})
