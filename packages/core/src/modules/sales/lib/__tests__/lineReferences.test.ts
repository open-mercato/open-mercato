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
    [{ kind: 'service', productId: PRODUCT_ID }],
    [{ kind: 'service', productVariantId: PRODUCT_ID, serviceId: null }],
  ])('accepts %j', (line) => {
    expect(findLineReferenceConflict(line)).toBeNull()
  })

  it('flags a service reference on a product line, including the default kind', () => {
    expect(findLineReferenceConflict({ kind: 'product', serviceId: SERVICE_ID })).toBe('service_on_non_service_line')
    expect(findLineReferenceConflict({ serviceId: SERVICE_ID })).toBe('service_on_non_service_line')
  })

  it('accepts the InboxOps service-line shape: kind service with a matched product and no service', () => {
    expect(
      findLineReferenceConflict({ kind: 'service', productId: PRODUCT_ID, productVariantId: null, serviceId: null }),
    ).toBeNull()
  })

  it('flags a line that references a service and a product or variant at the same time', () => {
    expect(
      findLineReferenceConflict({ kind: 'service', serviceId: SERVICE_ID, productId: PRODUCT_ID }),
    ).toBe('service_and_product_reference')
    expect(
      findLineReferenceConflict({ kind: 'service', serviceId: SERVICE_ID, productVariantId: PRODUCT_ID }),
    ).toBe('service_and_product_reference')
  })
})

describe('assertLineReferencesConsistent', () => {
  it('passes a consistent line through', async () => {
    await expect(assertLineReferencesConsistent({ kind: 'service', serviceId: SERVICE_ID }, 1)).resolves.toBeUndefined()
  })

  it('throws a 400 naming the line', async () => {
    await expect(
      assertLineReferencesConsistent({ kind: 'service', serviceId: SERVICE_ID, productId: PRODUCT_ID }, 3),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'Line 3 cannot reference both a service and a product or variant.' },
    })
  })
})
