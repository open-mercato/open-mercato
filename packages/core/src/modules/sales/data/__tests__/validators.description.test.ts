import {
  channelCreateSchema,
  channelUpdateSchema,
  shippingMethodCreateSchema,
  shippingMethodUpdateSchema,
} from '../validators'

const scope = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const recordId = '11111111-1111-4111-8111-111111111111'

describe.each([
  ['channel create', channelCreateSchema, { ...scope, name: 'Web channel', code: 'web' }],
  ['channel update', channelUpdateSchema, { id: recordId, code: 'web' }],
  ['shipping method create', shippingMethodCreateSchema, { ...scope, name: 'Courier', code: 'courier' }],
  ['shipping method update', shippingMethodUpdateSchema, { id: recordId }],
] as const)('%s description', (_label, schema, input) => {
  it.each([null, '', '   ', '  Description  ', 'x'.repeat(2000)])(
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

  it.each([42, false, {}, [], 'x'.repeat(2001)])(
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
