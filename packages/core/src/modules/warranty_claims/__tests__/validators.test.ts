import {
  claimLineCreateSchema,
  claimLineUpdateSchema,
  claimSetReturnLabelSchema,
  registrationCreateSchema,
  registrationUpdateSchema,
  vendorPolicyCreateSchema,
} from '../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const REGISTRATION_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
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

describe('claim line nullable decimal fields', () => {
  it.each([
    'qtyApproved',
    'qtyReceived',
    'creditAmount',
    'restockingFee',
    'coreChargeAmount',
    'coreCreditAmount',
  ] as const)('normalizes an empty %s value to null', (field) => {
    const result = claimLineCreateSchema.safeParse({
      ...scope,
      claimId: CLAIM_ID,
      qtyClaimed: 1,
      [field]: '',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data[field]).toBeNull()
  })
})

describe('claimSetReturnLabelSchema', () => {
  it('normalizes an empty label URL when another label reference is present', () => {
    const result = claimSetReturnLabelSchema.safeParse({
      ...scope,
      id: CLAIM_ID,
      labelUrl: '',
      trackingNumber: 'TRACK-1',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.labelUrl).toBeNull()
  })
})

describe('validation messages are translation keys, not raw English (#5287)', () => {
  const issueMessages = (result: { success: boolean; error?: { issues: { message: string }[] } }): string =>
    result.success ? '' : (result.error?.issues.map((issue) => issue.message).join(' ') ?? '')

  it('keys the approved-quantity min(0) message', () => {
    const result = claimLineUpdateSchema.safeParse({ id: CLAIM_ID, qtyApproved: -1 })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain('warranty_claims.errors.decimalNonNegative')
  })

  it('keys the vendor-policy contact email message', () => {
    const result = vendorPolicyCreateSchema.safeParse({ ...scope, vendorName: 'Acme', contactEmail: 'not-an-email' })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain('warranty_claims.errors.invalidEmail')
  })

  it('keys the return-label URL message', () => {
    const result = claimSetReturnLabelSchema.safeParse({ ...scope, id: CLAIM_ID, labelUrl: 'not a url' })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain('warranty_claims.errors.returnLabelUrlInvalid')
  })

  it('keys the recovery-rate format message (no raw regex leaked)', () => {
    const result = vendorPolicyCreateSchema.safeParse({ ...scope, vendorName: 'Acme', recoveryRatePct: 'abc' })
    expect(result.success).toBe(false)
    const messages = issueMessages(result)
    expect(messages).toContain('warranty_claims.errors.recoveryRateFormat')
    expect(messages).not.toContain('\\d')
  })

  it('keys the approved-exceeds-claimed guard message', () => {
    const result = claimLineUpdateSchema.safeParse({ id: CLAIM_ID, qtyClaimed: 2, qtyApproved: 5 })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain('warranty_claims.errors.qtyApprovedExceedsClaimed')
  })
})
