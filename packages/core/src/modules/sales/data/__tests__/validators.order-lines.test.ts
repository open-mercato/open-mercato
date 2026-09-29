import {
  orderCreateSchema,
  orderUpdateSchema,
  quoteCreateSchema,
  SALES_ORDER_LINES_REQUIRED_MESSAGE_KEY,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const LINE = {
  currencyCode: 'USD',
  quantity: 1,
  name: 'Required line',
  unitPriceNet: 10,
  unitPriceGross: 10,
}

describe('sales order line invariant', () => {
  it.each([
    ['omitted', {}],
    ['empty', { lines: [] }],
  ])('rejects an order when lines are %s', (_label, input) => {
    const result = orderCreateSchema.safeParse({ ...SCOPE, currencyCode: 'USD', ...input })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['lines'], message: SALES_ORDER_LINES_REQUIRED_MESSAGE_KEY }),
        ]),
      )
    }
  })

  it('accepts an order with one line', () => {
    expect(orderCreateSchema.safeParse({ ...SCOPE, currencyCode: 'USD', lines: [LINE] }).success).toBe(true)
  })

  it('keeps partial order updates valid without replacing lines', () => {
    expect(
      orderUpdateSchema.safeParse({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', comments: 'Header only' }).success,
    ).toBe(true)
  })

  it('does not apply the order invariant to quotes', () => {
    expect(quoteCreateSchema.safeParse({ ...SCOPE, currencyCode: 'USD' }).success).toBe(true)
  })
})
