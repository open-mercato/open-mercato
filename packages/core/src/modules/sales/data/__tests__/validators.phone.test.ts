import {
  channelCreateSchema,
  customerSnapshotSchema,
  orderCreateSchema,
  quoteCreateSchema,
  SALES_PHONE_INVALID_MESSAGE_KEY,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const VALID_PHONE = '+1 212 555 1234'
const INVALID_PHONE = 'test phone'

function findPhoneIssue(
  result: { success: false; error: { issues: { message: string; path: (string | number)[] }[] } },
) {
  return result.error.issues.find((issue) => issue.message === SALES_PHONE_INVALID_MESSAGE_KEY) ?? null
}

// ---------------------------------------------------------------------------
// channelCreateSchema.contactPhone
// ---------------------------------------------------------------------------

describe('channelCreateSchema — contactPhone validation', () => {
  const base = {
    ...SCOPE,
    name: 'Web channel',
    code: 'web',
  }

  it('accepts a valid international phone number', () => {
    const result = channelCreateSchema.safeParse({ ...base, contactPhone: VALID_PHONE })
    expect(result.success).toBe(true)
  })

  it('accepts when contactPhone is omitted', () => {
    const result = channelCreateSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('rejects free-text contactPhone', () => {
    const result = channelCreateSchema.safeParse({ ...base, contactPhone: INVALID_PHONE })
    expect(result.success).toBe(false)
    if (!result.success) expect(findPhoneIssue(result)).not.toBeNull()
  })

  it('rejects phone missing the country code', () => {
    const result = channelCreateSchema.safeParse({ ...base, contactPhone: '212 555 1234' })
    expect(result.success).toBe(false)
    if (!result.success) expect(findPhoneIssue(result)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// customerSnapshotSchema (shared between order/quote create + document update)
// ---------------------------------------------------------------------------

describe('customerSnapshotSchema — primaryPhone validation', () => {
  it('accepts a valid international phone in the customer snapshot', () => {
    const result = customerSnapshotSchema.safeParse({
      customer: { primaryPhone: VALID_PHONE, displayName: 'Acme' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a null primaryPhone', () => {
    const result = customerSnapshotSchema.safeParse({
      customer: { primaryPhone: null, displayName: 'Acme' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty primaryPhone string', () => {
    const result = customerSnapshotSchema.safeParse({
      customer: { primaryPhone: '', displayName: 'Acme' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts when customer is null', () => {
    const result = customerSnapshotSchema.safeParse({ customer: null })
    expect(result.success).toBe(true)
  })

  it('preserves additional snapshot fields via passthrough', () => {
    const result = customerSnapshotSchema.safeParse({
      customer: { primaryPhone: VALID_PHONE, displayName: 'Acme', extra: 'value' },
      contact: { firstName: 'Jane' },
      legacy: 'still-here',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).legacy).toBe('still-here')
    }
  })

  it('rejects a free-text primaryPhone', () => {
    const result = customerSnapshotSchema.safeParse({
      customer: { primaryPhone: INVALID_PHONE, displayName: 'Acme' },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(findPhoneIssue(result)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// orderCreateSchema.customerSnapshot.primaryPhone
// ---------------------------------------------------------------------------

describe('orderCreateSchema — customerSnapshot phone validation', () => {
  const base = {
    ...SCOPE,
    currencyCode: 'USD',
  }

  it('accepts a valid customer snapshot phone', () => {
    const result = orderCreateSchema.safeParse({
      ...base,
      customerSnapshot: { customer: { primaryPhone: VALID_PHONE } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a free-text customer snapshot phone', () => {
    const result = orderCreateSchema.safeParse({
      ...base,
      customerSnapshot: { customer: { primaryPhone: INVALID_PHONE } },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(findPhoneIssue(result)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// quoteCreateSchema.customerSnapshot.primaryPhone
// ---------------------------------------------------------------------------

describe('quoteCreateSchema — customerSnapshot phone validation', () => {
  const base = {
    ...SCOPE,
    currencyCode: 'USD',
  }

  it('accepts a valid customer snapshot phone', () => {
    const result = quoteCreateSchema.safeParse({
      ...base,
      customerSnapshot: { customer: { primaryPhone: VALID_PHONE } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a free-text customer snapshot phone', () => {
    const result = quoteCreateSchema.safeParse({
      ...base,
      customerSnapshot: { customer: { primaryPhone: INVALID_PHONE } },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(findPhoneIssue(result)).not.toBeNull()
  })
})
