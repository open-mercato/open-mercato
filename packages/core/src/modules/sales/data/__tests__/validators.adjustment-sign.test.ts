import { z } from 'zod'
import {
  DISCOUNT_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
  DISCOUNT_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
  RETURN_ADJUSTMENT_POSITIVE_GROSS_MESSAGE,
  RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE,
  RETURN_ADJUSTMENT_ZERO_MESSAGE,
  SHIPPING_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
  SHIPPING_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
  SURCHARGE_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
  SURCHARGE_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
  TAX_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
  TAX_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
  enforceAdjustmentSign,
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
  .superRefine(enforceAdjustmentSign)

const quoteUpsertSchema = quoteAdjustmentCreateSchema
  .extend({ id: z.string().uuid().optional() })
  .superRefine(enforceAdjustmentSign)

describe('enforceAdjustmentSign — return adjustments', () => {
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

  it('rejects zero amounts for kind="return" (issue #3037)', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 0,
      amountGross: 0,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_ZERO_MESSAGE)
    }
  })

  it('rejects a return with no amounts supplied (issue #3037)', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_ZERO_MESSAGE)
    }
  })

  it('accepts a return when only one negative amount is supplied', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountGross: -5,
    })
    expect(result.success).toBe(true)
  })

  it('does not flag a positive return as zero-valued', () => {
    const result = orderUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 5,
      amountGross: 5,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_POSITIVE_NET_MESSAGE)
      expect(messages).not.toContain(RETURN_ADJUSTMENT_ZERO_MESSAGE)
    }
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

  it('keeps backward-compatible enforceReturnAdjustmentSign export pointing at the unified helper', () => {
    expect(enforceReturnAdjustmentSign).toBe(enforceAdjustmentSign)
  })
})

describe('enforceAdjustmentSign — non-return kinds (issue #1905)', () => {
  const base = {
    ...SCOPE,
    orderId: ORDER_ID,
    scope: 'order' as const,
    currencyCode: 'USD',
  }

  const nonNegativeCases: Array<{
    kind: 'discount' | 'surcharge' | 'shipping' | 'tax'
    netMessage: string
    grossMessage: string
  }> = [
    {
      kind: 'discount',
      netMessage: DISCOUNT_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
      grossMessage: DISCOUNT_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
    },
    {
      kind: 'surcharge',
      netMessage: SURCHARGE_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
      grossMessage: SURCHARGE_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
    },
    {
      kind: 'shipping',
      netMessage: SHIPPING_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
      grossMessage: SHIPPING_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
    },
    {
      kind: 'tax',
      netMessage: TAX_ADJUSTMENT_NEGATIVE_NET_MESSAGE,
      grossMessage: TAX_ADJUSTMENT_NEGATIVE_GROSS_MESSAGE,
    },
  ]

  for (const { kind, netMessage, grossMessage } of nonNegativeCases) {
    it(`rejects negative amountNet and amountGross for kind="${kind}"`, () => {
      const result = orderUpsertSchema.safeParse({
        ...base,
        kind,
        amountNet: -10,
        amountGross: -10,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message)
        expect(messages).toContain(netMessage)
        expect(messages).toContain(grossMessage)
      }
    })

    it(`rejects negative-only amountGross for kind="${kind}"`, () => {
      const result = orderUpsertSchema.safeParse({
        ...base,
        kind,
        amountNet: 5,
        amountGross: -5,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message)
        expect(messages).toContain(grossMessage)
        expect(messages).not.toContain(netMessage)
      }
    })

    it(`accepts zero amounts for kind="${kind}"`, () => {
      const result = orderUpsertSchema.safeParse({
        ...base,
        kind,
        amountNet: 0,
        amountGross: 0,
      })
      expect(result.success).toBe(true)
    })

    it(`accepts positive amounts for kind="${kind}"`, () => {
      const result = orderUpsertSchema.safeParse({
        ...base,
        kind,
        amountNet: 15,
        amountGross: 18,
      })
      expect(result.success).toBe(true)
    })
  }

  it('leaves kind="custom" sign unconstrained (operator-controlled)', () => {
    const positive = orderUpsertSchema.safeParse({
      ...base,
      kind: 'custom',
      amountNet: 5,
      amountGross: 5,
    })
    expect(positive.success).toBe(true)
    const negative = orderUpsertSchema.safeParse({
      ...base,
      kind: 'custom',
      amountNet: -5,
      amountGross: -5,
    })
    expect(negative.success).toBe(true)
  })

  it('rejects negative discount amounts on quote adjustments', () => {
    const result = quoteUpsertSchema.safeParse({
      ...SCOPE,
      quoteId: QUOTE_ID,
      scope: 'order' as const,
      currencyCode: 'USD',
      kind: 'discount',
      amountNet: -3,
      amountGross: -3,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(DISCOUNT_ADJUSTMENT_NEGATIVE_NET_MESSAGE)
    }
  })
})

describe('enforceAdjustmentSign — quote adjustments retain return behavior', () => {
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

  it('rejects zero amounts for kind="return" on quote adjustments (issue #3037)', () => {
    const result = quoteUpsertSchema.safeParse({
      ...base,
      kind: 'return',
      amountNet: 0,
      amountGross: 0,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain(RETURN_ADJUSTMENT_ZERO_MESSAGE)
    }
  })
})
