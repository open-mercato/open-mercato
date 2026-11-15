/** @jest-environment node */

import {
  invoiceCreateSchema,
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
})
