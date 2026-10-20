import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findWithDecryptionMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn() }) }),
}))

import explainConfig, { CATALOG_PRICE_REFERENCE_FEATURES, CATALOG_PRICE_REFERENCE_KIND } from '../insights.explain'
import { CatalogProductPrice } from '../data/entities'
import { features as catalogFeatures } from '../acl'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const PRICE_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_PRICE_ID = '55555555-5555-4555-8555-555555555555'
const PRODUCT_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const PRICE_KIND_ID = '88888888-8888-4888-8888-888888888888'
const CHANNEL_ID = '99999999-9999-4999-8999-999999999999'
const CUSTOMER_GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em: {} as EntityManager,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function getResolver() {
  const resolver = explainConfig.referenceResolvers?.find((entry) => entry.kind === CATALOG_PRICE_REFERENCE_KIND)
  if (!resolver) throw new Error('[internal] missing catalog price reference resolver')
  return resolver
}

const priceKind = {
  id: PRICE_KIND_ID,
  code: 'regular',
  title: 'Regular',
  displayMode: 'excluding-tax',
}

const productPrice = {
  id: PRICE_ID,
  organizationId: ORG_A,
  tenantId: TENANT_ID,
  product: { id: PRODUCT_ID },
  variant: null,
  offer: null,
  priceKind,
  currencyCode: 'USD',
  kind: 'regular',
  minQuantity: 1,
  maxQuantity: 10,
  unitPriceNet: '19.9900',
  unitPriceGross: '24.5877',
  channelId: CHANNEL_ID,
  customerGroupId: CUSTOMER_GROUP_ID,
  customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: null,
  userGroupId: null,
  startsAt: new Date('2026-10-01T00:00:00.000Z'),
  endsAt: null,
}

describe('catalog insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the catalog.price reference resolver behind the catalog view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(explainConfig.resources ?? []).toEqual([])
    expect(getResolver().requiredFeatures).toEqual(CATALOG_PRICE_REFERENCE_FEATURES)
    expect(CATALOG_PRICE_REFERENCE_FEATURES).toEqual(['catalog.products.view'])
    expect(catalogFeatures.map((feature) => feature.id)).toEqual(expect.arrayContaining(CATALOG_PRICE_REFERENCE_FEATURES))
  })

  it('resolves price rows in one tenant- and organization-scoped query', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      productPrice,
      {
        ...productPrice,
        id: VARIANT_PRICE_ID,
        product: null,
        variant: { id: VARIANT_ID, product: { id: PRODUCT_ID } },
        offer: null,
        customerId: null,
        customerGroupId: null,
        userGroupId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        maxQuantity: null,
        startsAt: null,
        unitPriceGross: null,
        priceKind: { id: PRICE_KIND_ID, code: 'promo', title: '  ', displayMode: 'including-tax' },
      },
    ])
    const details = await getResolver().resolve(
      buildContext({ organizationIds: [ORG_A] }),
      [PRICE_ID, PRICE_ID.toUpperCase(), VARIANT_PRICE_ID, 'not-a-uuid'],
    )

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const [, entity, where, options, scope] = findWithDecryptionMock.mock.calls[0]
    expect(entity).toBe(CatalogProductPrice)
    expect(where).toEqual({
      id: { $in: [PRICE_ID, VARIANT_PRICE_ID] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(options).toEqual({ populate: ['priceKind', 'variant'] })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
    expect(details).toEqual([
      {
        kind: 'catalog.price',
        id: PRICE_ID,
        label: 'Regular',
        href: `/backend/catalog/products/${PRODUCT_ID}`,
        organizationId: ORG_A,
        facts: {
          unitPriceNet: '19.9900',
          unitPriceGross: '24.5877',
          currencyCode: 'USD',
          priceKindId: PRICE_KIND_ID,
          priceKindCode: 'regular',
          priceKindTitle: 'Regular',
          displayMode: 'excluding-tax',
          kind: 'regular',
          productId: PRODUCT_ID,
          variantId: null,
          offerId: null,
          channelId: CHANNEL_ID,
          customerGroupId: CUSTOMER_GROUP_ID,
          customerSpecific: true,
          userSpecific: false,
          minQuantity: 1,
          maxQuantity: 10,
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: null,
        },
      },
      {
        kind: 'catalog.price',
        id: VARIANT_PRICE_ID,
        label: 'promo',
        href: `/backend/catalog/products/${PRODUCT_ID}`,
        organizationId: ORG_A,
        facts: expect.objectContaining({
          unitPriceGross: null,
          priceKindTitle: null,
          productId: PRODUCT_ID,
          variantId: VARIANT_ID,
          customerSpecific: false,
          userSpecific: true,
          maxQuantity: null,
          startsAt: null,
        }),
      },
    ])
    expect(JSON.stringify(details)).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('queries tenant-wide for an unrestricted scope', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await getResolver().resolve(buildContext(), [PRICE_ID])
    const [, , where, , scope] = findWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ id: { $in: [PRICE_ID] }, tenantId: TENANT_ID })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: null })
  })

  it('restricts the query to every scoped organization', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await getResolver().resolve(buildContext({ organizationIds: [ORG_A, ORG_B] }), [PRICE_ID])
    const [, , where, , scope] = findWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ id: { $in: [PRICE_ID] }, tenantId: TENANT_ID, organizationId: { $in: [ORG_A, ORG_B] } })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: null })
  })

  it('skips the query for a denied scope, an invalid tenant or no valid ids', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [PRICE_ID])).resolves.toEqual([])
    await expect(getResolver().resolve(buildContext({ tenantId: 'tenant-1' }), [PRICE_ID])).resolves.toEqual([])
    await expect(getResolver().resolve(buildContext(), ['price-1', ''])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('reports a failed lookup and resolves nothing', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [PRICE_ID])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      module: 'catalog',
      code: 'catalog.insights_reference_failed',
    }))
  })
})
