import type { XeroContact } from '../lib/contacts/contact'
import { findXeroOrphanedCompanies, XERO_ORPHAN_MIN_AGE_MS } from '../lib/contacts/orphans'
import { classifyXeroContact, isSupplierOnly } from '../lib/contacts/rules'

function contact(fields: Partial<XeroContact> = {}): XeroContact {
  return { ContactID: 'c1', Name: 'Acme Ltd', ContactStatus: 'ACTIVE', IsCustomer: true, IsSupplier: false, ...fields }
}

describe('classifyXeroContact — App Spec § 6.4', () => {
  it('archives a mapped Company of an archived Contact through a normal write, and skips an unmapped one', () => {
    expect(classifyXeroContact(contact({ ContactStatus: 'ARCHIVED' }), true)).toEqual({ kind: 'write' })
    expect(classifyXeroContact(contact({ ContactStatus: 'ARCHIVED' }), false)).toEqual({ kind: 'skip' })
  })

  it('only flips the status of a mapped GDPR-redacted Contact, and skips an unmapped one', () => {
    expect(classifyXeroContact(contact({ ContactStatus: 'GDPRREQUEST', Name: '' }), true)).toEqual({ kind: 'status_only' })
    expect(classifyXeroContact(contact({ ContactStatus: 'gdprrequest' }), false)).toEqual({ kind: 'skip' })
  })

  it('filters a supplier-only Contact out of first syncs but keeps updating a mapped one', () => {
    const supplier = contact({ IsSupplier: true, IsCustomer: false })
    expect(isSupplierOnly(supplier)).toBe(true)
    expect(classifyXeroContact(supplier, false)).toEqual({ kind: 'skip' })
    expect(classifyXeroContact(supplier, true)).toEqual({ kind: 'write' })
  })

  it('imports a Contact with both flags false, both flags true, or an individual\'s name', () => {
    expect(classifyXeroContact(contact({ IsCustomer: false, IsSupplier: false }), false)).toEqual({ kind: 'write' })
    expect(classifyXeroContact(contact({ IsCustomer: true, IsSupplier: true }), false)).toEqual({ kind: 'write' })
    expect(classifyXeroContact(contact({ Name: 'Jane Doe', IsCustomer: null, IsSupplier: null }), false)).toEqual({ kind: 'write' })
  })

  it('lets the merge rule win over the archive rule for a mapped Contact', () => {
    const merged = contact({ ContactStatus: 'ARCHIVED', MergedToContactID: ' survivor ' })
    expect(classifyXeroContact(merged, true)).toEqual({ kind: 'merge_mark', survivingContactId: 'survivor' })
    expect(classifyXeroContact(merged, false)).toEqual({ kind: 'skip' })
    expect(classifyXeroContact(contact({ MergedToContactID: '' }), true)).toEqual({ kind: 'write' })
  })
})

describe('findXeroOrphanedCompanies', () => {
  const now = new Date('2026-10-13T12:00:00.000Z')
  const old = new Date(now.getTime() - XERO_ORPHAN_MIN_AGE_MS)
  const young = new Date(now.getTime() - XERO_ORPHAN_MIN_AGE_MS + 1)
  const mappings = new Map([
    ['org:c1', 'e1'],
    ['org:c2', 'e-other'],
  ])

  it('reports a marked Company its Contact maps to another Company or to none, older than a minute only', () => {
    const orphans = findXeroOrphanedCompanies(
      {
        companies: [
          { entityId: 'e1', createdAt: old, displayName: 'A' },
          { entityId: 'e2', createdAt: old, displayName: 'B' },
          { entityId: 'e3', createdAt: old, displayName: 'C' },
          { entityId: 'e4', createdAt: young, displayName: 'D' },
        ],
        markers: [
          { entityId: 'e1', value: 'org:c1' },
          { entityId: 'e2', value: 'org:c2' },
          { entityId: 'e3', value: 'org:c3' },
          { entityId: 'e4', value: 'org:c4' },
          { entityId: 'e-deleted', value: 'org:c5' },
        ],
        taxNumbers: [],
      },
      { lookup: (externalId) => mappings.get(externalId) ?? null },
      now,
    )

    expect(orphans).toEqual([
      { entityId: 'e2', marker: 'org:c2', mappedEntityId: 'e-other' },
      { entityId: 'e3', marker: 'org:c3', mappedEntityId: null },
    ])
  })
})
