import { z } from 'zod'
import {
  RETURN_ADJUSTMENT_POSITIVE_GROSS_MESSAGE,
  RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE,
  enforceReturnAdjustmentSign,
  orderAdjustmentCreateSchema,
  quoteAdjustmentCreateSchema,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const QUOTE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const orderUpsertSchema = orderAdjustmentCreateSchema
  .extend({ id: z.string().uuid().optional() })
  .superRefine(enforceReturnAdjustmentSign)

const quoteUpsertSchema = quoteAdjustmentCreateSchema
  .extend({ id: z.string().uuid().optional() })
  .superRefine(enforceReturnAdjustmentSign)

describe('enforceReturnAdjustmentSign — order adjustments', () => {
  const base = {
    ...SCOPE,
    orderId: ORDER_ID,
    scope: 'order' as const,
    currencyCode: 'USD',
  }

  it('rejects positive amountNet for kind="return"', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 1,
      amountGross: 1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE)
      expect(messages).toContain(RETURN_ADJUSTMENT_POSITIVE_GROSS_MESSAGE)
    }
  })

  it('rejects positive-only amountGross for kind="return"', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: -1,
      amountGross: 1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_POSITIVE_GROSS_MESSAGE)
      expect(messages).not.toContain(RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE)
    }
  })

  it('accepts negative amounts for kind="return"', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: -12,
      amountGross: -12,
    })
    expect(result.success).toBe(true)
  })

  it('accepts zero amounts for kind="return"', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 0,
      amountGross: 0,
    })
    expect(result.success).toBe(true)
  })

  it('accepts positive amounts for non-return adjustments', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'surcharge',
      amountNet: 5,
      amountGross: 5,
    })
    expect(result.success).toBe(true)
  })
})

describe('enforceReturnAdjustmentSign — quote adjustments', () => {
  const base = {
    ...SCOPE,
    quoteId: QUOTE_ID,
    scope: 'order' as const,
    currencyCode: 'USD',
  }

  it('rejects positive amountNet for kind="return" on quote adjustments', () => {
    const result = quoteUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 1,
      amountGross: 1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE)
    }
  })

  it('accepts negative amounts for kind="return" on quote adjustments', () => {
    const result = quoteUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: -7.5,
      amountGross: -7.5,
    })
    expect(result.success).toBe(true)
  })
})
