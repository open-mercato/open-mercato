import { quoteDocumentInputSchema } from '../validators'

const quoteId = '22222222-2222-4222-8222-222222222222'

describe('quoteDocumentInputSchema', () => {
  it('accepts a UUID and strips untrusted record fields', () => {
    expect(quoteDocumentInputSchema.parse({
      id: quoteId,
      grandTotalGrossAmount: '0.01',
      lines: [{ total: '0.01' }],
    })).toEqual({ id: quoteId })
  })

  it.each([
    {},
    { id: '' },
    { id: 'not-a-uuid' },
  ])('rejects invalid input %#', (input) => {
    expect(quoteDocumentInputSchema.safeParse(input).success).toBe(false)
  })
})
