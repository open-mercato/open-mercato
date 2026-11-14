import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { filterRowsForVariant, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import {
  DefaultCatalogBuyerPricingService,
  type BuyerPricingContext,
} from '@open-mercato/core/modules/catalog/services/catalogBuyerPricingService'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import { resolveStorefrontPrices } from '../storefrontPricing'
import type { BuyerContext, StoreContext } from '../types'

/**
 * Step 8.11 (3.4 Part A) guard test: proves `storefrontPricing.ts`'s own batched resolution and
 * `catalogBuyerPricingService.resolveLinePrice`'s per-line resolution agree on the SAME unit price
 * for the SAME `CatalogProductPrice` rows, even though `storefrontPricing.ts` deliberately does NOT
 * repoint onto the buyer-pricing service (see that file's header comment and
 * `.ai/runs/2026-10-14-ecommerce-release-4-write-side/NOTIFY.md`'s 2026-10-15T00:30:00Z entry for why).
 * If this test ever fails on a genuine amount mismatch (not a fixture/harness bug), the two pricing
 * paths have silently drifted and the exemption's "verified-equivalent" premise no longer holds.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry', () => ({
  ...jest.requireActual('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry'),
  resolveOmnibusPresentedEntries: jest.fn(async () => new Map()),
}))

const mockedFind = findWithDecryption as jest.Mock

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const CHANNEL_ID = 'channel-1'

type RowInput = {
  id: string
  productId: string
  variantId?: string | null
  isPromotion?: boolean
  net?: string | null
  gross?: string | null
  taxRate?: string | null
  minQuantity?: number
  customerGroupId?: string | null
}

function buildRow(input: RowInput): PriceRow {
  return {
    id: input.id,
    product: { id: input.productId },
    variant: input.variantId ? { id: input.variantId } : null,
    offer: null,
    priceKind: input.isPromotion
      ? { id: 'pk-promo', code: 'promotion', isPromotion: true }
      : { id: 'pk-regular', code: 'regular', isPromotion: false },
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    currencyCode: 'EUR',
    kind: input.isPromotion ? 'promotion' : 'regular',
    minQuantity: input.minQuantity ?? 1,
    maxQuantity: null,
    unitPriceNet: input.net === undefined ? null : input.net,
    unitPriceGross: input.gross === undefined ? null : input.gross,
    taxRate: input.taxRate ?? null,
    taxAmount: null,
    channelId: null,
    userId: null,
    userGroupId: null,
    customerId: null,
    customerGroupId: input.customerGroupId ?? null,
    metadata: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as PriceRow
}

function installPriceRows(rows: PriceRow[], taxRates: Array<Record<string, unknown>> = []) {
  mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    // Mirrors a real Postgres fetch for a `product OR variant` clause: every variant's row also
    // carries the parent product id, so the DB returns every sibling variant's rows too. Returning
    // the full fixture regardless of `where` exercises each service's OWN in-memory narrowing
    // (`matchesContext`/`filterRowsForVariant`) rather than relying on the mock to narrow for it.
    if (entity === CatalogProductPrice) return rows
    if (entity === SalesTaxRate) {
      const tenantId = where.tenantId as string
      const organizationId = where.organizationId as string
      return taxRates.filter((rate) => rate.tenantId === tenantId && rate.organizationId === organizationId)
    }
    return []
  })
}

function makeBuyer(overrides: Partial<BuyerContext> = {}): BuyerContext {
  return {
    customerUserId: null,
    customerId: null,
    companyId: null,
    customerIds: [],
    customerGroupIds: [],
    isAuthenticated: false,
    taxMode: 'net',
    priceKindId: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    assortmentScope: null,
    assortmentScopeHash: 'none',
    priceScopeKey: 'key',
    customerOverlayId: null,
    ...overrides,
  }
}

function makeStoreContext(buyer: Partial<BuyerContext> = {}): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    channel: {
      channelBindingId: 'binding-1',
      salesChannelId: CHANNEL_ID,
      priceKindId: null,
      priceSortFallback: 'approximate',
    },
    buyer: makeBuyer(buyer),
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest: 'digest',
  }
}

function makeContainer() {
  const services: Record<string, unknown> = {
    em: {},
    catalogPricingService: new DefaultCatalogPricingService(null),
    catalogOmnibusService: undefined,
  }
  return {
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`not registered: ${name}`)
      return services[name]
    },
  }
}

function buyerPricingService(): DefaultCatalogBuyerPricingService {
  return new DefaultCatalogBuyerPricingService(new DefaultCatalogPricingService(null))
}

function buyerContext(overrides: Partial<BuyerPricingContext> = {}): BuyerPricingContext {
  return {
    channelId: null,
    customerId: null,
    customerIds: [],
    customerGroupId: null,
    customerGroupIds: [],
    currencyCode: 'EUR',
    quantity: 1,
    date: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  }
}

const em = {} as any
const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

beforeEach(() => {
  mockedFind.mockReset()
})

describe('storefrontPricing vs catalogBuyerPricingService equivalence guard (3.4 Part A)', () => {
  it('(a) resolves a base/regular price row to the same net unit price on both paths', async () => {
    const rows = [buildRow({ id: 'row-regular', productId: 'product-1', net: '42.5000' })]
    installPriceRows(rows)

    const storefront = await resolveStorefrontPrices(makeContainer(), makeStoreContext(), [
      { productId: 'product-1', variantIds: [] },
    ])
    const buyerResult = await buyerPricingService().resolveLinePrice(em, rows, buyerContext(), scope)

    expect(storefront.get('product-1')?.price?.amount).toBe(42.5)
    expect(storefront.get('product-1')?.price?.amount).toBe(buyerResult.amountNet)
  })

  it('(b) resolves a sale-kind (promotional) row over a regular row identically on both paths', async () => {
    const rows = [
      buildRow({ id: 'row-regular', productId: 'product-1', net: '50.0000' }),
      buildRow({ id: 'row-promo', productId: 'product-1', net: '35.0000', isPromotion: true }),
    ]
    installPriceRows(rows)

    const storefront = await resolveStorefrontPrices(makeContainer(), makeStoreContext(), [
      { productId: 'product-1', variantIds: [] },
    ])
    const buyerResult = await buyerPricingService().resolveLinePrice(em, rows, buyerContext(), scope)

    expect(buyerResult.priceRow?.id).toBe('row-promo')
    expect(storefront.get('product-1')?.price?.amount).toBe(35)
    expect(storefront.get('product-1')?.price?.amount).toBe(buyerResult.amountNet)
  })

  it('(c) collapses quantity-tier rows into the same tier bands on both paths', async () => {
    const rows = [
      buildRow({ id: 'tier-1', productId: 'product-1', net: '10.0000', minQuantity: 1 }),
      buildRow({ id: 'tier-5', productId: 'product-1', net: '9.0000', minQuantity: 5 }),
      buildRow({ id: 'tier-10', productId: 'product-1', net: '8.0000', minQuantity: 10 }),
    ]
    installPriceRows(rows)

    const storefront = await resolveStorefrontPrices(
      makeContainer(),
      makeStoreContext(),
      [{ productId: 'product-1', variantIds: [] }],
      { detail: true },
    )
    const buyerResult = await buyerPricingService().resolveLinePrice(em, rows, buyerContext(), scope)

    const storefrontTiers = (storefront.get('product-1')?.priceTiers ?? []).map((tier) => ({
      minQuantity: tier.minQuantity,
      maxQuantity: tier.maxQuantity,
      amount: tier.amount,
    }))
    const buyerTiers = buyerResult.tiers.map((tier) => ({
      minQuantity: tier.minQuantity,
      maxQuantity: tier.maxQuantity,
      amount: tier.amountNet,
    }))
    expect(storefrontTiers).toEqual(buyerTiers)
    expect(storefrontTiers).toEqual([
      { minQuantity: 1, maxQuantity: 4, amount: 10 },
      { minQuantity: 5, maxQuantity: 9, amount: 9 },
      { minQuantity: 10, maxQuantity: null, amount: 8 },
    ])
  })

  it('(d) applies a customer-group-specific row only for a matching group, identically on both paths', async () => {
    const rows = [
      buildRow({ id: 'row-default', productId: 'product-1', net: '20.0000' }),
      buildRow({ id: 'row-group', productId: 'product-1', net: '15.0000', customerGroupId: 'group-a' }),
    ]
    installPriceRows(rows)

    const storefrontForGroup = await resolveStorefrontPrices(
      makeContainer(),
      makeStoreContext({ customerGroupIds: ['group-a'] }),
      [{ productId: 'product-1', variantIds: [] }],
    )
    const buyerForGroup = await buyerPricingService().resolveLinePrice(
      em,
      rows,
      buyerContext({ customerGroupIds: ['group-a'] }),
      scope,
    )
    expect(buyerForGroup.priceRow?.id).toBe('row-group')
    expect(storefrontForGroup.get('product-1')?.price?.amount).toBe(15)
    expect(storefrontForGroup.get('product-1')?.price?.amount).toBe(buyerForGroup.amountNet)

    const storefrontDefault = await resolveStorefrontPrices(makeContainer(), makeStoreContext(), [
      { productId: 'product-1', variantIds: [] },
    ])
    const buyerDefault = await buyerPricingService().resolveLinePrice(em, rows, buyerContext(), scope)
    expect(buyerDefault.priceRow?.id).toBe('row-default')
    expect(storefrontDefault.get('product-1')?.price?.amount).toBe(20)
    expect(storefrontDefault.get('product-1')?.price?.amount).toBe(buyerDefault.amountNet)
  })

  it('(e) F14: two variants of one product each resolve their OWN price, never a sibling\'s, on both paths', async () => {
    const rows = [
      buildRow({ id: 'row-variant-a', productId: 'product-1', variantId: 'variant-a', net: '11.0000' }),
      buildRow({ id: 'row-variant-b', productId: 'product-1', variantId: 'variant-b', net: '22.0000' }),
    ]
    installPriceRows(rows)

    const storefront = await resolveStorefrontPrices(makeContainer(), makeStoreContext(), [
      { productId: 'product-1', variantIds: ['variant-a', 'variant-b'] },
    ])
    const variantPrices = storefront.get('product-1')?.variantPrices
    const buyerForA = await buyerPricingService().resolveLinePrice(
      em,
      filterRowsForVariant(rows, 'variant-a'),
      buyerContext(),
      scope,
    )
    const buyerForB = await buyerPricingService().resolveLinePrice(
      em,
      filterRowsForVariant(rows, 'variant-b'),
      buyerContext(),
      scope,
    )

    expect(variantPrices?.get('variant-a')?.amount).toBe(11)
    expect(variantPrices?.get('variant-b')?.amount).toBe(22)
    expect(variantPrices?.get('variant-a')?.amount).toBe(buyerForA.amountNet)
    expect(variantPrices?.get('variant-b')?.amount).toBe(buyerForB.amountNet)
  })

  it('(e) a variant-level row overrides a product-level row for the matching variant only, on both paths', async () => {
    const rows = [
      buildRow({ id: 'row-product-level', productId: 'product-1', net: '30.0000' }),
      buildRow({ id: 'row-variant-a', productId: 'product-1', variantId: 'variant-a', net: '25.0000' }),
    ]
    installPriceRows(rows)

    const storefront = await resolveStorefrontPrices(makeContainer(), makeStoreContext(), [
      { productId: 'product-1', variantIds: ['variant-a', 'variant-b'] },
    ])
    const variantPrices = storefront.get('product-1')?.variantPrices
    const buyerForA = await buyerPricingService().resolveLinePrice(
      em,
      filterRowsForVariant(rows, 'variant-a'),
      buyerContext(),
      scope,
    )
    const buyerForB = await buyerPricingService().resolveLinePrice(
      em,
      filterRowsForVariant(rows, 'variant-b'),
      buyerContext(),
      scope,
    )

    expect(variantPrices?.get('variant-a')?.amount).toBe(25)
    expect(variantPrices?.get('variant-b')?.amount).toBe(30)
    expect(variantPrices?.get('variant-a')?.amount).toBe(buyerForA.amountNet)
    expect(variantPrices?.get('variant-b')?.amount).toBe(buyerForB.amountNet)
  })
})
