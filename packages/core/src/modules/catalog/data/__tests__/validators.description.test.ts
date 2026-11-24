import {
  categoryBulkCreateRowSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  offerCreateSchema,
  offerUpdateSchema,
  optionSchemaTemplateCreateSchema,
  optionSchemaTemplateUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
} from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const productId = '11111111-1111-4111-8111-111111111111'
const offerId = '44444444-4444-4444-8444-444444444444'
const channelId = '55555555-5555-4555-8555-555555555555'
const categoryId = '66666666-6666-4666-8666-666666666666'
const templateId = '77777777-7777-4777-8777-777777777777'

describe.each([
  ['create', productCreateSchema, { ...scope, title: 'Synthetic product' }],
  ['update', productUpdateSchema, { ...scope, id: productId, subtitle: 'New subtitle' }],
] as const)('product description on %s (issue #10003)', (_operation, schema, input) => {
  it.each([null, '', '   ', '  Product description  ', 'x'.repeat(4000)])(
    'accepts a nullable description and preserves string normalization (case %#)',
    (description) => {
      const result = schema.parse({ ...input, description })

      expect(result.description).toBe(description === null ? null : description.trim())
    },
  )

  it('preserves omission instead of turning it into a clear', () => {
    const result = schema.parse(input)

    expect(result).not.toHaveProperty('description')
  })

  it.each([42, false, {}, [], 'x'.repeat(4001)])(
    'rejects invalid descriptions (case %#)',
    (description) => {
      const result = schema.safeParse({ ...input, description })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ['description'] })]),
        )
      }
    },
  )
})

describe.each([
  ['create', offerCreateSchema, { ...scope, productId, channelId, title: 'Synthetic offer' }],
  ['update', offerUpdateSchema, { id: offerId, title: 'New title' }],
] as const)('offer description on %s', (_operation, schema, input) => {
  it.each([null, '', '   ', '  Offer description  ', 'x'.repeat(4000)])(
    'accepts a nullable description and preserves string normalization (case %#)',
    (description) => {
      const result = schema.parse({ ...input, description })

      expect(result.description).toBe(description === null ? null : description.trim())
    },
  )

  it('keeps an omitted description distinct from null', () => {
    const result = schema.parse(input)

    expect(result).not.toHaveProperty('description')
  })

  it.each([42, false, {}, [], 'x'.repeat(4001)])(
    'rejects invalid descriptions (case %#)',
    (description) => {
      const result = schema.safeParse({ ...input, description })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ['description'] })]),
        )
      }
    },
  )
})

describe('offer description nested in a product update', () => {
  it('accepts a null description', () => {
    const result = productUpdateSchema.parse({
      ...scope,
      id: productId,
      offers: [{ channelId, title: 'Synthetic offer', description: null }],
    })

    expect(result.offers?.[0]?.description).toBeNull()
  })
})

describe.each([
  ['category create', categoryCreateSchema, { ...scope, name: 'Synthetic category' }, 2000],
  ['category update', categoryUpdateSchema, { id: categoryId, name: 'Renamed category' }, 2000],
  ['category bulk-create row', categoryBulkCreateRowSchema, { name: 'Synthetic category' }, 2000],
  [
    'option schema template create',
    optionSchemaTemplateCreateSchema,
    { ...scope, name: 'Synthetic template', schema: { options: [] } },
    4000,
  ],
  ['option schema template update', optionSchemaTemplateUpdateSchema, { id: templateId, name: 'Renamed template' }, 4000],
] as const)('%s description', (_operation, schema, input, maxLength) => {
  it.each([null, '', '  Description  ', 'x'.repeat(maxLength)])(
    'accepts a nullable description and preserves string normalization (case %#)',
    (description) => {
      const result = schema.parse({ ...input, description })

      expect(result.description).toBe(description === null ? null : description.trim())
    },
  )

  it('keeps an omitted description distinct from null', () => {
    const result = schema.parse(input)

    expect(result).not.toHaveProperty('description')
  })

  it.each([42, false, {}, [], 'x'.repeat(maxLength + 1)])(
    'rejects invalid descriptions (case %#)',
    (description) => {
      const result = schema.safeParse({ ...input, description })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ['description'] })]),
        )
      }
    },
  )
})
