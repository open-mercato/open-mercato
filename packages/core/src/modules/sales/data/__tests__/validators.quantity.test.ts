import {
  quoteLineCreateSchema,
  orderLineCreateSchema,
  shipmentCreateSchema,
  invoiceCreateSchema,
  creditMemoCreateSchema,
  returnCreateSchema,
} from '../validators'

const MAX_QUANTITY = 999_999_999

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function expectQuantityError(result: { success: false; error: { issues: { message: string }[] } }) {
  const messages = result.error.issues.map((i) => i.message)
  expect(messages).toContain('Quantity is too large.')
}

// ---------------------------------------------------------------------------
// quoteLineCreateSchema
// ---------------------------------------------------------------------------

describe('quoteLineCreateSchema — quantity validation', () => {
  const base = {
    ...SCOPE,
    quoteId: UUID,
    currencyCode: 'USD',
  }

  it('accepts quantity = 0', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: 0 })
    expect(result.success).toBe(true)
  })

  it('accepts quantity = MAX_QUANTITY', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: MAX_QUANTITY })
    expect(result.success).toBe(true)
  })

  it('rejects quantity = MAX_QUANTITY + 1', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: MAX_QUANTITY + 1 })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })

  it('rejects negative quantity', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: -1 })
    expect(result.success).toBe(false)
  })

  it('accepts normalizedQuantity = MAX_QUANTITY', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: 1, normalizedQuantity: MAX_QUANTITY })
    expect(result.success).toBe(true)
  })

  it('rejects normalizedQuantity = MAX_QUANTITY + 1', () => {
    const result = quoteLineCreateSchema.safeParse({ ...base, quantity: 1, normalizedQuantity: MAX_QUANTITY + 1 })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })
})

// ---------------------------------------------------------------------------
// orderLineCreateSchema
// ---------------------------------------------------------------------------

describe('orderLineCreateSchema — quantity validation', () => {
  const base = {
    ...SCOPE,
    orderId: UUID,
    currencyCode: 'USD',
  }

  it('accepts quantity = MAX_QUANTITY', () => {
    const result = orderLineCreateSchema.safeParse({ ...base, quantity: MAX_QUANTITY })
    expect(result.success).toBe(true)
  })

  it('rejects quantity = MAX_QUANTITY + 1', () => {
    const result = orderLineCreateSchema.safeParse({ ...base, quantity: MAX_QUANTITY + 1 })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })
})

// ---------------------------------------------------------------------------
// shipmentCreateSchema — items quantity
// ---------------------------------------------------------------------------

describe('shipmentCreateSchema — items quantity validation', () => {
  const base = {
    ...SCOPE,
    orderId: UUID,
  }

  it('accepts item quantity = MAX_QUANTITY', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: MAX_QUANTITY }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects item quantity = MAX_QUANTITY + 1', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: MAX_QUANTITY + 1 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })

  it('accepts integer quantity = 1', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: 1 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts integer quantity = 0', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: 0 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts integer quantity = 100', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: 100 }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects fractional quantity = 0.7', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: 0.7 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('Quantity must be a whole number.')
    }
  })

  it('rejects fractional quantity = 1.5', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: 1.5 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('Quantity must be a whole number.')
    }
  })

  it('rejects negative quantity', () => {
    const result = shipmentCreateSchema.safeParse({
      ...base,
      items: [{ orderLineId: UUID, quantity: -1 }],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// invoiceCreateSchema — lines quantity
// ---------------------------------------------------------------------------

describe('invoiceCreateSchema — lines quantity validation', () => {
  const base = {
    ...SCOPE,
    invoiceNumber: 'INV-001',
    currencyCode: 'USD',
  }

  it('accepts line quantity = MAX_QUANTITY', () => {
    const result = invoiceCreateSchema.safeParse({
      ...base,
      lines: [{ quantity: MAX_QUANTITY, currencyCode: 'USD' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects line quantity = MAX_QUANTITY + 1', () => {
    const result = invoiceCreateSchema.safeParse({
      ...base,
      lines: [{ quantity: MAX_QUANTITY + 1, currencyCode: 'USD' }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })
})

// ---------------------------------------------------------------------------
// creditMemoCreateSchema — lines quantity
// ---------------------------------------------------------------------------

describe('creditMemoCreateSchema — lines quantity validation', () => {
  const base = {
    ...SCOPE,
    creditMemoNumber: 'CM-001',
    currencyCode: 'USD',
  }

  it('accepts line quantity = MAX_QUANTITY', () => {
    const result = creditMemoCreateSchema.safeParse({
      ...base,
      lines: [{ quantity: MAX_QUANTITY, currencyCode: 'USD' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects line quantity = MAX_QUANTITY + 1', () => {
    const result = creditMemoCreateSchema.safeParse({
      ...base,
      lines: [{ quantity: MAX_QUANTITY + 1, currencyCode: 'USD' }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })
})

// ---------------------------------------------------------------------------
// returnCreateSchema — integer-only quantity (issue #1540)
// ---------------------------------------------------------------------------

describe('returnCreateSchema — quantity validation', () => {
  const base = {
    ...SCOPE,
    orderId: UUID,
  }

  it('accepts integer quantity', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: 1 }],
    })
    expect(result.success).toBe(true)
  })

  it('coerces integer-string quantity', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: '3' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lines[0].quantity).toBe(3)
    }
  })

  it('rejects fractional quantity (0.9)', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: 0.9 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('Return quantity must be a whole number.')
    }
  })

  it('rejects fractional quantity passed as string', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: '0.9' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero quantity', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative quantity', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: -1 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects quantity = MAX_QUANTITY + 1', () => {
    const result = returnCreateSchema.safeParse({
      ...base,
      lines: [{ orderLineId: UUID, quantity: MAX_QUANTITY + 1 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expectQuantityError(result)
  })
})
