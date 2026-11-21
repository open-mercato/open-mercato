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

  // Regression: checkout's document creation spreads a SalesLineSnapshot straight
  // into `lines`, and that type declares productVariantId/configuration/quantityUnit
  // (among others) as `| null`, which entity-to-snapshot mappers like
  // toCartTotalsLineSnapshot set explicitly rather than omitting. The schema must
  // accept `null` wherever the snapshot type allows it, or a plain product with no
  // variant/configuration fails order/quote creation with "expected string, received null".
  const SNAPSHOT_SHAPED_LINE = {
    ...LINE,
    productId: null,
    productVariantId: null,
    description: null,
    comment: null,
    quantityUnit: null,
    normalizedQuantity: null,
    normalizedUnit: null,
    uomSnapshot: null,
    configuration: null,
    promotionCode: null,
    metadata: null,
    customFieldSetId: null,
    customFields: null,
    discountAmount: null,
    discountAmountBasis: null,
    discountPercent: null,
    taxRate: null,
    taxAmount: null,
    totalNetAmount: null,
    totalGrossAmount: null,
    amountsMode: null,
  }

  it('accepts an order line whose optional fields are explicit null, as a cart snapshot line produces', () => {
    const result = orderCreateSchema.safeParse({ ...SCOPE, currencyCode: 'USD', lines: [SNAPSHOT_SHAPED_LINE] })
    expect(result.success).toBe(true)
  })

  it('accepts a quote line whose optional fields are explicit null, as a cart snapshot line produces', () => {
    const result = quoteCreateSchema.safeParse({ ...SCOPE, currencyCode: 'USD', lines: [SNAPSHOT_SHAPED_LINE] })
    expect(result.success).toBe(true)
  })

  it('accepts a null name and unit prices, as SalesLineSnapshot allows', () => {
    const result = orderCreateSchema.safeParse({
      ...SCOPE,
      currencyCode: 'USD',
      lines: [{ ...LINE, name: null, unitPriceNet: null, unitPriceGross: null }],
    })
    expect(result.success).toBe(true)
  })

  it('still rejects a malformed non-null line value', () => {
    const result = orderCreateSchema.safeParse({
      ...SCOPE,
      currencyCode: 'USD',
      lines: [{ ...LINE, productVariantId: 'not-a-uuid' }],
    })
    expect(result.success).toBe(false)
  })
})
