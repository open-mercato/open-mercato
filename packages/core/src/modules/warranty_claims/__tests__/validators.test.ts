import {
  registrationCreateSchema,
  registrationUpdateSchema,
  vendorPolicyCreateSchema,
} from '../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const REGISTRATION_ID = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }

describe('registrationCreateSchema', () => {
  it('rejects a registration with no serial number (dead-data guard)', () => {
    const result = registrationCreateSchema.safeParse({ ...scope })
    expect(result.success).toBe(false)
  })

  it('rejects a registration with a blank serial number', () => {
    const result = registrationCreateSchema.safeParse({ ...scope, serialNumber: '   ' })
    expect(result.success).toBe(false)
  })

  it('accepts a registration with a serial number', () => {
    const result = registrationCreateSchema.safeParse({ ...scope, serialNumber: 'SN-123' })
    expect(result.success).toBe(true)
  })
})

describe('registrationUpdateSchema', () => {
  it('allows omitting the serial number on a partial update', () => {
    const result = registrationUpdateSchema.safeParse({ id: REGISTRATION_ID, ...scope, notes: 'touch' })
    expect(result.success).toBe(true)
  })

  it('rejects clearing the serial number to empty on update', () => {
    const result = registrationUpdateSchema.safeParse({ id: REGISTRATION_ID, ...scope, serialNumber: '' })
    expect(result.success).toBe(false)
  })
})

describe('vendorPolicyCreateSchema recovery rate', () => {
  it('rejects a recovery rate above 100 with a clear message', () => {
    const result = vendorPolicyCreateSchema.safeParse({ ...scope, vendorName: 'Acme', recoveryRatePct: 150 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(' ')
      expect(message).toContain('warranty_claims.errors.recoveryRateRange')
    }
  })

  it('accepts a valid string recovery rate', () => {
    const result = vendorPolicyCreateSchema.safeParse({ ...scope, vendorName: 'Acme', recoveryRatePct: '80' })
    expect(result.success).toBe(true)
  })

  it('accepts a null recovery rate', () => {
    const result = vendorPolicyCreateSchema.safeParse({ ...scope, vendorName: 'Acme', recoveryRatePct: null })
    expect(result.success).toBe(true)
  })
})
