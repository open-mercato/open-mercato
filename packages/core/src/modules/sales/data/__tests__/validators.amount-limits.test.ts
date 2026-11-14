import {
  SALES_AMOUNT_INVALID_MESSAGE_KEY,
  orderLineCreateSchema,
  paymentCreateSchema,
  shipmentCreateSchema,
  shippingMethodCreateSchema,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const TOO_MANY_DIGITS = `0.${'1'.repeat(1001)}`

function issueMessages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.error ? result.error.issues.map((issue) => issue.message) : []
}

describe('sales money fields reject amounts beyond the decimal size caps', () => {
  const payment = { ...SCOPE, orderId: UUID, currencyCode: 'USD' }
  const line = { ...SCOPE, orderId: UUID, currencyCode: 'USD', quantity: 1 }

  it.each([
    ['a numeric 1e305', 1e305],
    ['a string 1e305', '1e305'],
    ['Number.MAX_VALUE', Number.MAX_VALUE],
    ['a 1001 significant digit string', TOO_MANY_DIGITS],
  ])('rejects a payment amount of %s', (_label, amount) => {
    const result = paymentCreateSchema.safeParse({ ...payment, amount })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain(SALES_AMOUNT_INVALID_MESSAGE_KEY)
  })

  it.each([
    ['a numeric 1e305', 1e305],
    ['a 1001 significant digit string', TOO_MANY_DIGITS],
  ])('rejects a line unit price of %s', (_label, unitPriceNet) => {
    const result = orderLineCreateSchema.safeParse({ ...line, unitPriceNet })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain(SALES_AMOUNT_INVALID_MESSAGE_KEY)
  })

  it('rejects an oversized shipping method base rate', () => {
    const result = shippingMethodCreateSchema.safeParse({
      ...SCOPE,
      name: 'Courier',
      code: 'courier',
      baseRateNet: '1e305',
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain(SALES_AMOUNT_INVALID_MESSAGE_KEY)
  })

  it('keeps accepting amounts within the caps as numbers', () => {
    const largest = `${'9'.repeat(300)}`
    const result = paymentCreateSchema.safeParse({ ...payment, amount: largest })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amount).toBe(Number(largest))

    const precise = orderLineCreateSchema.safeParse({ ...line, unitPriceNet: '12.345678901234567890' })
    expect(precise.success).toBe(true)
    if (precise.success) expect(precise.data.unitPriceNet).toBe(12.345678901234567)
  })

  it('keeps the existing coercion, min and optional semantics', () => {
    expect(paymentCreateSchema.safeParse({ ...payment, amount: '' }).success).toBe(true)
    expect(paymentCreateSchema.safeParse({ ...payment, amount: -1 }).success).toBe(false)
    expect(paymentCreateSchema.safeParse({ ...payment, amount: 'abc' }).success).toBe(false)
    const omitted = orderLineCreateSchema.safeParse(line)
    expect(omitted.success).toBe(true)
    if (omitted.success) expect(omitted.data.unitPriceNet).toBeUndefined()
  })

  it('keeps the whole number rule on shipment item quantities', () => {
    const result = shipmentCreateSchema.safeParse({
      ...SCOPE,
      orderId: UUID,
      items: [{ orderLineId: UUID, quantity: 1.5 }],
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain('Quantity must be a whole number.')
  })
})
