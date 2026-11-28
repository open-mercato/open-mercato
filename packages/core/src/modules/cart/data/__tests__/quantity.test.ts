import {
  cartLineAddInputSchema,
  cartLineAddRequestSchema,
  cartLineBulkAddRequestSchema,
  cartLineUpdateRequestSchema,
} from '../validators'

const productId = '00000000-0000-4000-8000-000000000001'
const cartId = '00000000-0000-4000-8000-000000000002'

const schemas = [
  (quantity: string) => cartLineAddInputSchema.safeParse({ cartId, productId, quantity }),
  (quantity: string) => cartLineAddRequestSchema.safeParse({ productId, quantity }),
  (quantity: string) => cartLineUpdateRequestSchema.safeParse({ quantity }),
  (quantity: string) => cartLineBulkAddRequestSchema.safeParse({ lines: [{ productId, quantity }] }),
]

describe.each(schemas)('cart quantity storage validation %#', (parse) => {
  it.each(['999999999999.9999', '999999999999.9998', '1.2345', '0.0001', '1.23000', '0', '-1'])('accepts %s exactly', (quantity) => {
    expect(parse(quantity).success).toBe(true)
  })

  it.each(['1000000000000', '1000000000000.0000', '999999999999.99995', '999999999999.99991', '1.00001', '0.00001', '9'.repeat(2049)])('rejects unsupported quantity %s', (quantity) => {
    expect(parse(quantity).success).toBe(false)
  })
})
