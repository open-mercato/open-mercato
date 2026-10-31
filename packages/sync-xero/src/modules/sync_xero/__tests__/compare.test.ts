import { buildCompanyCreateInput, diffCompanyUpdate, resolveCompanyStatus, type CompanySnapshot } from '../lib/contacts/compare'
import type { MappedXeroCompany } from '../lib/contacts/mapping'

const MARKER = 'a3b1c2d3-0000-4000-8000-000000000001:c0000000-0000-4000-8000-000000000001'

function company(fields: Partial<MappedXeroCompany> = {}): MappedXeroCompany {
  return {
    displayName: 'Acme Ltd',
    legalName: 'Acme Ltd',
    primaryEmail: 'billing@acme.example',
    primaryPhone: '+44 20 7946 0000',
    websiteUrl: 'https://acme.example',
    taxNumber: 'GB 123',
    contactStatus: 'ACTIVE',
    warnings: [],
    ...fields,
  }
}

function snapshot(fields: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    entityId: 'e0000000-0000-4000-8000-00000000000a',
    displayName: 'Acme Ltd',
    legalName: 'Acme Ltd',
    primaryEmail: 'billing@acme.example',
    primaryPhone: '+44 20 7946 0000',
    websiteUrl: 'https://acme.example',
    status: 'active',
    isActive: true,
    custom: { xero_contact_id: MARKER, xero_tax_number: 'GB 123' },
    ...fields,
  }
}

describe('resolveCompanyStatus', () => {
  it('archives on ARCHIVED and GDPRREQUEST, activates on create, and brings back only an archived Company', () => {
    expect(resolveCompanyStatus('ARCHIVED', snapshot())).toEqual({ status: 'archived', isActive: false })
    expect(resolveCompanyStatus('GDPRREQUEST', null)).toEqual({ status: 'archived', isActive: false })
    expect(resolveCompanyStatus('ACTIVE', null)).toEqual({ status: 'active', isActive: true })
    expect(resolveCompanyStatus(null, null)).toEqual({ status: 'active', isActive: true })
    expect(resolveCompanyStatus('ACTIVE', snapshot({ status: 'archived', isActive: false }))).toEqual({ status: 'active', isActive: true })
    expect(resolveCompanyStatus('ACTIVE', snapshot({ status: 'pending', isActive: true }))).toBeNull()
    expect(resolveCompanyStatus('ACTIVE', snapshot({ status: 'inactive', isActive: false }))).toBeNull()
  })
})

describe('buildCompanyCreateInput', () => {
  it('writes every non-blank Xero value, the active status, the marker and the tax number', () => {
    expect(buildCompanyCreateInput(company({ websiteUrl: null }), MARKER)).toEqual({
      displayName: 'Acme Ltd',
      legalName: 'Acme Ltd',
      primaryEmail: 'billing@acme.example',
      primaryPhone: '+44 20 7946 0000',
      status: 'active',
      isActive: true,
      customFields: { xero_contact_id: MARKER, xero_tax_number: 'GB 123' },
    })
    expect(buildCompanyCreateInput(company({ taxNumber: null, contactStatus: 'ARCHIVED' }), MARKER)).toMatchObject({
      status: 'archived',
      isActive: false,
      customFields: { xero_contact_id: MARKER },
    })
  })
})

describe('diffCompanyUpdate — compare-before-write', () => {
  it('answers null for an unchanged Company, so no command runs', () => {
    expect(diffCompanyUpdate(company(), MARKER, snapshot())).toBeNull()
  })

  it('holds only the Xero-owned values that differ', () => {
    const update = diffCompanyUpdate(company({ primaryEmail: 'accounts@acme.example', displayName: 'Acme Group', legalName: 'Acme Group' }), MARKER, snapshot())
    expect(update).toEqual({ displayName: 'Acme Group', legalName: 'Acme Group', primaryEmail: 'accounts@acme.example' })
  })

  it('never clears an OM value with a blank or left-out Xero value and never touches an OM-only field', () => {
    const current = snapshot({ status: 'pending', primaryPhone: '+48 600 000 000', websiteUrl: 'https://om.example' })
    const update = diffCompanyUpdate(company({ primaryPhone: null, websiteUrl: null, primaryEmail: null }), MARKER, current)
    expect(update).toBeNull()
    const changed = diffCompanyUpdate(company({ displayName: 'Acme Group', primaryPhone: null, websiteUrl: null }), MARKER, current)
    expect(Object.keys(changed ?? {})).toEqual(['displayName'])
  })

  it('archives and restores through status and isActive together', () => {
    expect(diffCompanyUpdate(company({ contactStatus: 'ARCHIVED' }), MARKER, snapshot())).toEqual({ status: 'archived', isActive: false })
    expect(diffCompanyUpdate(company(), MARKER, snapshot({ status: 'archived', isActive: false }))).toEqual({ status: 'active', isActive: true })
  })

  it('compares the tax number after normalization and writes the marker only while the Company has none', () => {
    expect(diffCompanyUpdate(company({ taxNumber: 'gb123' }), MARKER, snapshot())).toBeNull()
    expect(diffCompanyUpdate(company({ taxNumber: 'GB 999' }), MARKER, snapshot())).toEqual({ customFields: { xero_tax_number: 'GB 999' } })
    expect(diffCompanyUpdate(company(), MARKER, snapshot({ custom: { xero_tax_number: 'GB 123' } }))).toEqual({ customFields: { xero_contact_id: MARKER } })
    expect(diffCompanyUpdate(company(), MARKER, snapshot({ custom: { xero_contact_id: 'other:marker', xero_tax_number: 'GB123' } }))).toBeNull()
  })
})
