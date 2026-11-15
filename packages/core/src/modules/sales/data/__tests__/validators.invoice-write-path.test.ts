/** @jest-environment node */

import {
  INVOICE_NEGATIVE_LINE_TOTALS_REQUIRED_MESSAGE_KEY,
  INVOICE_NEGATIVE_NET_POSITIVE_GROSS_MESSAGE_KEY,
  INVOICE_REPLACE_LINES_REQUIRES_LINES_MESSAGE_KEY,
  INVOICE_REPLACE_LINES_REQUIRES_TOTALS_MESSAGE_KEY,
  invoiceCreateSchema,
  invoiceUpdateInputSchema,
  invoiceUpdateSchema,
} from '../validators'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const INVOICE_ID = '33333333-3333-4333-8333-333333333333'

const scope = { organizationId: ORG_ID, tenantId: TENANT_ID, currencyCode: 'EUR' }
const line = (overrides: Record<string, unknown> = {}) => ({ quantity: 1, currencyCode: 'EUR', ...overrides })

function messages(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message)
}

const LINE_KINDS = ['product', 'service', 'shipping', 'discount', 'adjustment'] as const
const SIGNED_LINE_FIELDS = ['unitPriceNet', 'unitPriceGross', 'taxAmount', 'totalNetAmount', 'totalGrossAmount'] as const

describe('invoice validators (#7336)', () => {
  describe('custom fields', () => {
    it.each([{ company: 'c-1' }, null, 'text', ['a'], undefined])('accepts customFields %p', (customFields) => {
      expect(invoiceCreateSchema.safeParse({ ...scope, customFields }).success).toBe(true)
    })
  })

  describe('negative amounts', () => {
    it.each(LINE_KINDS.flatMap((kind) => SIGNED_LINE_FIELDS.map((field) => [kind, field] as const)))(
      'accepts a negative %s line %s with both totals',
      (kind, field) => {
        const negativeLine = line({ kind, totalNetAmount: -10, totalGrossAmount: -12.3, [field]: -1 })
        const result = invoiceCreateSchema.safeParse({ ...scope, lines: [negativeLine] })
        expect(messages(result)).toEqual([])
        expect(result.data?.lines?.[0]?.[field]).toBe(-1)
      },
    )

    it.each(['quantity', 'discountAmount'])('still rejects a negative %s', (field) => {
      const result = invoiceCreateSchema.safeParse({ ...scope, lines: [line({ [field]: -1 })] })
      expect(result.success).toBe(false)
    })

    it.each([
      [{ unitPriceNet: -5, totalGrossAmount: -6 }, 'totalNetAmount'],
      [{ taxAmount: -1, totalNetAmount: -5 }, 'totalGrossAmount'],
    ])('requires both totals on a negative line %p', (amounts, missing) => {
      const result = invoiceCreateSchema.safeParse({ ...scope, lines: [line(amounts)] })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]).toMatchObject({
        message: INVOICE_NEGATIVE_LINE_TOTALS_REQUIRED_MESSAGE_KEY,
        path: ['lines', 0, missing],
      })
    })

    it('rejects a negative line with a net <= 0 and a positive gross', () => {
      const result = invoiceCreateSchema.safeParse({
        ...scope,
        lines: [line({ taxAmount: -1, totalNetAmount: 0, totalGrossAmount: 5 })],
      })
      expect(messages(result)).toEqual([INVOICE_NEGATIVE_NET_POSITIVE_GROSS_MESSAGE_KEY])
    })

    it('keeps accepting a non-negative line with a net of 0 and a positive gross', () => {
      const result = invoiceCreateSchema.safeParse({
        ...scope,
        lines: [line({ totalNetAmount: 0, totalGrossAmount: 5 })],
      })
      expect(result.success).toBe(true)
    })

    it.each(['taxTotalAmount', 'subtotalNetAmount', 'grandTotalNetAmount'])('accepts a negative header %s', (field) => {
      expect(invoiceCreateSchema.safeParse({ ...scope, [field]: -3 }).success).toBe(true)
      expect(invoiceUpdateSchema.safeParse({ id: INVOICE_ID, [field]: -3 }).success).toBe(true)
    })

    it.each(['subtotalGrossAmount', 'grandTotalGrossAmount', 'discountTotalAmount', 'paidTotalAmount'])(
      'still rejects a negative header %s',
      (field) => {
        expect(invoiceCreateSchema.safeParse({ ...scope, [field]: -3 }).success).toBe(false)
      },
    )
  })

  describe('replaceLines', () => {
    const totals = {
      subtotalNetAmount: 90,
      subtotalGrossAmount: 110.7,
      taxTotalAmount: 20.7,
      grandTotalNetAmount: 90,
      grandTotalGrossAmount: 110.7,
    }

    it('accepts replaceLines with lines and the five summing totals', () => {
      const result = invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, replaceLines: true, lines: [line()], ...totals })
      expect(messages(result)).toEqual([])
    })

    it('keeps accepting lines without replaceLines', () => {
      expect(invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, lines: [line()] }).success).toBe(true)
    })

    it.each([[undefined], [[]]])('rejects replaceLines with lines %p', (lines) => {
      const result = invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, replaceLines: true, lines, ...totals })
      expect(messages(result)).toEqual([INVOICE_REPLACE_LINES_REQUIRES_LINES_MESSAGE_KEY])
    })

    it.each(Object.keys(totals))('rejects replaceLines without %s', (missing) => {
      const { [missing as keyof typeof totals]: _omitted, ...rest } = totals
      const result = invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, replaceLines: true, lines: [line()], ...rest })
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ message: INVOICE_REPLACE_LINES_REQUIRES_TOTALS_MESSAGE_KEY, path: [missing] }),
      ])
    })

    it('keeps accepting replaceLines: false, which used to be stripped, without requiring lines or totals', () => {
      const result = invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, replaceLines: false, lines: [line()] })
      expect(messages(result)).toEqual([])
    })

    it.each([null, 'false', 0])('keeps accepting replaceLines %p, which used to be stripped', (replaceLines) => {
      expect(invoiceUpdateInputSchema.safeParse({ id: INVOICE_ID, replaceLines }).success).toBe(true)
    })

    it('keeps the line object unrefined so schemas derived from it still work', () => {
      const lineSchema = invoiceCreateSchema.shape.lines.unwrap().element
      expect(() => lineSchema.partial()).not.toThrow()
      expect(() => lineSchema.pick({ quantity: true })).not.toThrow()
    })

    it('keeps the exported update schema unrefined so .partial() still works', () => {
      expect(() => invoiceUpdateSchema.partial()).not.toThrow()
      expect(invoiceUpdateSchema.safeParse({ id: INVOICE_ID, replaceLines: true }).success).toBe(true)
    })
  })
})
