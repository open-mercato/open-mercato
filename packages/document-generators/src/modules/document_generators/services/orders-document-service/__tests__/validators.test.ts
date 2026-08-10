import { orderDocumentInputSchema } from '../validators'

const orderId = '11111111-1111-4111-8111-111111111111'

describe('orderDocumentInputSchema', () => {
  it('accepts a UUID and strips untrusted record fields', () => {
    expect(orderDocumentInputSchema.parse({
      id: orderId,
      grandTotalGrossAmount: '0.01',
      lines: [{ total: '0.01' }],
    })).toEqual({ id: orderId })
  })

  it.each([
    {},
    { id: '' },
    { id: 'not-a-uuid' },
  ])('rejects invalid input %#', (input) => {
    expect(orderDocumentInputSchema.safeParse(input).success).toBe(false)
  })
})
