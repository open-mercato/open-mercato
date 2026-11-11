import { productCreateSchema, productUpdateSchema } from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const productId = '11111111-1111-4111-8111-111111111111'

describe('product subtitle validator (issue #7730)', () => {
  it('accepts a null subtitle on create, matching the nullable DB column', () => {
    const result = productCreateSchema.safeParse({
      ...scope,
      title: 'Bug Alpha',
      subtitle: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a null subtitle on update so AI bulk-update payloads are not rejected', () => {
    const result = productUpdateSchema.safeParse({
      ...scope,
      id: productId,
      title: 'Bug Alpha SUB',
      subtitle: null,
    })
    expect(result.success).toBe(true)
  })

  it('still omits subtitle cleanly when not provided on update', () => {
    const result = productUpdateSchema.safeParse({
      ...scope,
      id: productId,
      title: 'Bug Alpha',
    })
    expect(result.success).toBe(true)
  })

  it('still rejects a subtitle longer than 255 characters', () => {
    const result = productUpdateSchema.safeParse({
      ...scope,
      id: productId,
      subtitle: 'x'.repeat(256),
    })
    expect(result.success).toBe(false)
  })
})
