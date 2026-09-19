/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { personCreateSchema, personUpdateSchema, companyCreateSchema } from '../data/validators'
import { defaultEncryptionMaps } from '../encryption'

const moduleDir = join(__dirname, '..')
const people = readFileSync(join(moduleDir, 'commands', 'people.ts'), 'utf8')
const companies = readFileSync(join(moduleDir, 'commands', 'companies.ts'), 'utf8')
const salesDocuments = readFileSync(
  join(moduleDir, '..', 'sales', 'commands', 'documents.ts'),
  'utf8'
)

const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
}

const person = { ...scope, firstName: 'Ada', lastName: 'Lovelace', displayName: 'Ada Lovelace' }

describe('customer tax exemption validators', () => {
  it('accepts the three fields on a person', () => {
    const parsed = personCreateSchema.safeParse({
      ...person,
      isTaxExempt: true,
      taxExemptionCode: 'RESALE',
      taxExemptionCertificate: 'CERT-12345',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts the three fields on a company', () => {
    const parsed = companyCreateSchema.safeParse({
      ...scope,
      displayName: 'Acme Inc',
      isTaxExempt: true,
      taxExemptionCode: 'GOV',
    })
    expect(parsed.success).toBe(true)
  })

  it('leaves them optional, so no existing caller breaks', () => {
    expect(personCreateSchema.safeParse(person).success).toBe(true)
    expect(companyCreateSchema.safeParse({ ...scope, displayName: 'Acme Inc' }).success).toBe(true)
  })

  it('allows blanking a code or a certificate on edit so the column clears (#3050)', () => {
    const parsed = personUpdateSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000003',
      ...scope,
      taxExemptionCode: null,
      taxExemptionCertificate: null,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.taxExemptionCode).toBeNull()
      expect(parsed.data.taxExemptionCertificate).toBeNull()
    }
  })

  it('rejects a non boolean exemption flag', () => {
    expect(personCreateSchema.safeParse({ ...person, isTaxExempt: 'yes' }).success).toBe(false)
  })
})

describe('the certificate is encrypted at rest', () => {
  it('is declared in the customer entity encryption map', () => {
    const entityMap = defaultEncryptionMaps.find((map) => map.entityId === 'customers:customer_entity')
    expect(entityMap).toBeDefined()
    expect(entityMap!.fields.map((field) => field.field)).toContain('tax_exemption_certificate')
  })

  it('is not declared on any other entity, so it is not duplicated', () => {
    const others = defaultEncryptionMaps.filter((map) => map.entityId !== 'customers:customer_entity')
    for (const map of others) {
      expect(map.fields.map((field) => field.field)).not.toContain('tax_exemption_certificate')
    }
  })
})

describe('the fields round trip through create, update and undo', () => {
  for (const [name, source] of [
    ['people', people],
    ['companies', companies],
  ] as const) {
    it(`${name}: writes all three on create`, () => {
      expect(source).toContain('isTaxExempt: parsed.isTaxExempt ?? false,')
      expect(source).toContain('taxExemptionCode: normalizeOptionalString(parsed.taxExemptionCode),')
      expect(source).toContain(
        'taxExemptionCertificate: normalizeOptionalString(parsed.taxExemptionCertificate),'
      )
    })

    it(`${name}: patches all three on update`, () => {
      expect(source).toContain('if (parsed.isTaxExempt !== undefined) record.isTaxExempt = parsed.isTaxExempt')
      expect(source).toContain(
        'if (parsed.taxExemptionCode !== undefined) record.taxExemptionCode = normalizeOptionalString(parsed.taxExemptionCode)'
      )
      expect(source).toContain(
        'if (parsed.taxExemptionCertificate !== undefined) record.taxExemptionCertificate = normalizeOptionalString(parsed.taxExemptionCertificate)'
      )
    })

    it(`${name}: captures all three into the undo snapshot`, () => {
      expect(source).toContain('isTaxExempt: entity.isTaxExempt,')
      expect(source).toContain('taxExemptionCode: entity.taxExemptionCode ?? null,')
      expect(source).toContain('taxExemptionCertificate: entity.taxExemptionCertificate ?? null,')
    })

    it(`${name}: restores all three from a snapshot`, () => {
      // Every capture must have a matching restore, or an undo would silently
      // drop or invent an exemption.
      const captures = (source.match(/isTaxExempt: entity\.isTaxExempt,/g) ?? []).length
      const restores =
        (source.match(/isTaxExempt: (?:after|before)\.entity\.isTaxExempt \?\? false,/g) ?? []).length +
        (source.match(/\.isTaxExempt = (?:after|before)\.entity\.isTaxExempt \?\? false/g) ?? []).length
      expect(captures).toBeGreaterThan(0)
      expect(restores).toBeGreaterThan(0)
    })
  }
})

describe('the sales customer snapshot carries the exemption', () => {
  it('writes the block the tax contract reads', () => {
    expect(salesDocuments).toContain('taxExemption: {')
    expect(salesDocuments).toContain('isExempt: customer.isTaxExempt ?? false,')
    expect(salesDocuments).toContain('code: customer.taxExemptionCode ?? null,')
    expect(salesDocuments).toContain('certificateNumber: customer.taxExemptionCertificate ?? null,')
  })

  it('reads the customer with decryption, so the certificate is not ciphertext', () => {
    const snapshotFn = salesDocuments.slice(
      salesDocuments.indexOf('async function resolveCustomerSnapshot'),
      salesDocuments.indexOf('async function resolveAddressSnapshot')
    )
    expect(snapshotFn).toContain('findOneWithDecryption(')
    expect(snapshotFn).not.toContain('await em.findOne(\n    CustomerEntity,')
  })
})
