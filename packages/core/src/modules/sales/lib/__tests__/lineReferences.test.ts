import { assertLineReferencesConsistent, findLineReferenceConflict } from '../lineReferences'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string, vars?: Record<string, string>) =>
      (fallback ?? _key).replace('{{line}}', vars?.line ?? ''),
  }),
}))

const SERVICE_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'

describe('findLineReferenceConflict', () => {
  it.each([
    [{ kind: 'service', serviceId: SERVICE_ID }],
    [{ kind: 'product', productId: PRODUCT_ID }],
    [{ kind: 'service', serviceId: null, productId: null, productVariantId: null }],
    [{ productId: PRODUCT_ID }],
    [{ kind: 'shipping' }],
  ])('accepts %j', (line) => {
    expect(findLineReferenceConflict(line)).toBeNull()
  })

  it('flags a service reference on a product line, including the default kind', () => {
    expect(findLineReferenceConflict({ kind: 'product', serviceId: SERVICE_ID })).toBe('service_on_non_service_line')
    expect(findLineReferenceConflict({ serviceId: SERVICE_ID })).toBe('service_on_non_service_line')
  })

  it('flags a product or variant on a service line', () => {
    expect(findLineReferenceConflict({ kind: 'service', productId: PRODUCT_ID })).toBe('product_on_service_line')
    expect(findLineReferenceConflict({ kind: 'service', productVariantId: PRODUCT_ID })).toBe('product_on_service_line')
  })
})

describe('assertLineReferencesConsistent', () => {
  it('passes a consistent line through', async () => {
    await expect(assertLineReferencesConsistent({ kind: 'service', serviceId: SERVICE_ID }, 1)).resolves.toBeUndefined()
  })

  it('throws a 400 naming the line', async () => {
    await expect(assertLineReferencesConsistent({ kind: 'service', productId: PRODUCT_ID }, 3)).rejects.toMatchObject({
      status: 400,
      body: { error: 'Line 3 is a service line and cannot reference a product or variant.' },
    })
  })
})
