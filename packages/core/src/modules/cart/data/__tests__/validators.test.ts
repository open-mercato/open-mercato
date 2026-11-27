import { cartLineAddRequestSchema, cartLineBulkAddRequestSchema, cartLineUpdateRequestSchema } from '../validators'

const productId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

it.each(['1000000000000', '1.00001'])('rejects quantities outside storage precision in all public mutations (%s)', (quantity) => {
  expect(cartLineAddRequestSchema.safeParse({ productId, quantity }).success).toBe(false)
  expect(cartLineUpdateRequestSchema.safeParse({ quantity }).success).toBe(false)
  expect(cartLineBulkAddRequestSchema.safeParse({ lines: [{ productId, quantity }] }).success).toBe(false)
})

it.each(['999999999999.9999', '1.25000'])('accepts quantities that fit the storage precision (%s)', (quantity) => {
  expect(cartLineUpdateRequestSchema.safeParse({ quantity }).success).toBe(true)
})
