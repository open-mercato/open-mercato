type Row = Record<string, any>

const mockFindWithDecryption = jest.fn(async (_em: unknown, _entity: unknown) => [] as Row[])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import type { SalesAdjustmentDraft } from '@open-mercato/core/modules/sales/lib/types'
import type { Cart, CartLine } from '../../data/entities'
import { buildCartLineRepricePhases, buildRecomputeCartTotalsPhase } from '../reprice'
import type { CartPriceChange } from '../reprice'
import { buildPromotionsEffectsPhase } from '../promotionContext'
import type { CartPromotionWarning } from '../promotionContext'

// Step 7.6 — Phase 3 release gate: the P95 <= 150ms benchmark at 200 promotions x 50 lines
// (`.ai/specs/2026-08-14-cart-module.md` §14 `TC-CART-PROM-07`, §15 Phase 3 gate text).
//
// Mirrors Step 2.8's own benchmark
// (`promotions/lib/__tests__/evaluation-engine-performance.test.ts`) METHODOLOGY exactly —
// same `SAMPLE_RUNS`/P95-percentile shape, same "a realistic mix, not N copies of the same
// trivial effect" fixture-builder discipline, same "deliberately NOT an HTTP/DB round-trip"
// discipline — but it does NOT re-measure what Step 2.8 already measured (promotions' OWN
// `evaluatePromotions` cost: ~5ms for this exact 200x50 workload, far under budget). This
// benchmark instead measures `cart`'s OWN additional glue cost layered on top of a
// `promotionsService.evaluate()` call during `cart.reprice`: the per-line catalog re-price
// phase (`buildCartLineRepricePhases`), the promotions-effects mapping / gift-line /
// `CartPromotionApplication`-sync phase (`buildPromotionsEffectsPhase` — the main target
// this step exists to benchmark), and the totals-recompute phase
// (`buildRecomputeCartTotalsPhase`) — the same three real production functions
// `commands/cart.ts`'s `cart.reprice` command chains together, unchanged, run back-to-back
// per sample.
//
// No DB, no network, no real catalog/sales/promotions service calls: `findWithDecryption` is
// `jest.mock`'d (the same no-DB harness `lib/__tests__/promotionContext.test.ts` already
// proved sufficient to exercise `buildPromotionsEffectsPhase` in full), `em.find/create/
// persist/remove` are synchronous in-memory stubs, and `catalogBuyerPricingService
// .resolveLinePrice` / `salesCalculationService.calculate{Line,DocumentTotals}` are
// instant synthetic stubs — their OWN cost is each already somebody else's measured concern
// (catalog pricing's real I/O is out of scope here; Step 5.4's
// `totalsEquivalence.property.test.ts` already exercises `calculateDocumentTotals`'s real
// algorithmic cost over 500 generated cases). What this benchmark actually times is cart's
// OWN mapping/branching/object-construction cost — the thing Step 2.8's own benchmark never
// touched because it stops at `evaluatePromotions` and never reaches `cart` at all.

const PROMOTION_COUNT = 200
const LINE_COUNT = 50
const SAMPLE_RUNS = 25
const P95_BUDGET_MS = 150
const TENANT_ID = 'tenant-perf'
const ORG_ID = 'org-perf'
const GIFT_PRODUCT_COUNT = 20

function computeP95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.min(rank, sorted.length - 1)]
}

function makeCart(): Cart {
  return {
    id: 'cart-perf',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'storefront',
    currencyCode: 'USD',
    locale: 'en-US',
    customerId: null,
    customerIds: [],
    customerGroupIds: [],
    salesChannelId: null,
    priceKindId: null,
    promotionEffects: null,
  } as unknown as Cart
}

function makeLines(count: number): CartLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`,
    cartId: 'cart-perf',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNumber: i + 1,
    productId: `perf-product-${i}`,
    variantId: null,
    sku: `SKU-${i}`,
    name: `Perf Widget ${i}`,
    quantity: '2',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    discountTotalNet: null,
    promotionId: null,
    origin: 'customer' as const,
    flagState: null,
    deletedAt: null,
    configuration: null,
    lineTotals: {},
    pricedAt: null,
    priceKindId: null,
    priceRowId: null,
    priceTierMinQuantity: null,
  })) as unknown as CartLine[]
}

/**
 * A realistic mix, not 200 copies of the same trivial effect — matches Step 2.8's own
 * fixture-builder discipline. 120 `LINE_DISCOUNT` (spread across the 50 lines, exercising the
 * per-line discount write path several times over), 60 `CART_DISCOUNT` (order-scope, no line
 * target, exercising the adjustments/order-scope path), 20 `ADD_FREE_ITEM` (20 distinct gift
 * products, exercising the gift-line-creation path) = 200 total.
 */
function buildAppliedPromotions(lines: CartLine[]): Row[] {
  const applied: Row[] = []
  for (let i = 0; i < 120; i += 1) {
    const line = lines[i % lines.length]
    applied.push({
      promotionId: `perf-promo-line-${i}`,
      promotionName: `Perf Line Discount ${i}`,
      effects: [
        {
          type: 'LINE_DISCOUNT',
          appliesTo: 'line',
          currency: 'USD',
          label: { en: `Perf line discount ${i}` },
          targetLineId: line.id,
          targetProductId: line.productId,
          targetVariantId: null,
          lineQuantity: 2,
          appliedQuantity: 2,
          amountNet: '-1.0000',
          amountGross: '-1.2000',
          basis: 'net',
        },
      ],
    })
  }
  for (let i = 0; i < 60; i += 1) {
    applied.push({
      promotionId: `perf-promo-cart-${i}`,
      promotionName: `Perf Cart Discount ${i}`,
      effects: [
        {
          type: 'CART_DISCOUNT',
          appliesTo: 'order',
          currency: 'USD',
          label: { en: `Perf cart discount ${i}` },
          amountNet: '-0.5000',
          amountGross: '-0.6000',
          basis: 'net',
        },
      ],
    })
  }
  for (let i = 0; i < GIFT_PRODUCT_COUNT; i += 1) {
    applied.push({
      promotionId: `perf-promo-gift-${i}`,
      promotionName: `Perf Gift ${i}`,
      effects: [
        {
          type: 'ADD_FREE_ITEM',
          appliesTo: 'order',
          productId: `perf-gift-product-${i}`,
          variantId: null,
          quantity: 1,
        },
      ],
    })
  }
  return applied
}

function makeEm() {
  const em: any = {
    find: jest.fn(async () => [] as Row[]),
    findOne: jest.fn(async () => null),
    create: jest.fn((_ctor: unknown, data: Row) => ({ id: `generated-${Math.random()}`, ...data })),
    persist: jest.fn(() => undefined),
    remove: jest.fn(() => undefined),
  }
  return em
}

function makeContainer(appliedPromotions: Row[]) {
  const resolveLinePrice = jest.fn(async () => ({
    amountNet: 10,
    amountGross: 12,
    taxRatePercent: 20,
    priceRow: 'perf-price-kind',
    currentTier: null,
    nextTier: null,
  }))
  const calculateLine = jest.fn(async ({ line }: any) => ({
    line,
    netAmount: 0,
    grossAmount: 0,
    taxAmount: 0,
    discountAmount: 0,
    adjustments: [],
  }))
  const calculateDocumentTotals = jest.fn(async () => ({
    totals: {
      subtotalNetAmount: 1000,
      subtotalGrossAmount: 1200,
      discountTotalAmount: 100,
      taxTotalAmount: 200,
      grandTotalNetAmount: 900,
      grandTotalGrossAmount: 1100,
    },
  }))
  const evaluate = jest.fn(async () => ({ appliedPromotions }))
  const extendReservation = jest.fn(async () => undefined)
  return {
    resolve: (token: string): any => {
      if (token === 'catalogBuyerPricingService') return { resolveLinePrice }
      if (token === 'salesCalculationService') return { calculateLine, calculateDocumentTotals }
      if (token === 'promotionsService') return { evaluate, extendReservation }
      throw new Error(`[internal] Unexpected DI token in performance benchmark: ${token}`)
    },
  }
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === CatalogProduct) {
      return Array.from({ length: GIFT_PRODUCT_COUNT }, (_, i) => ({
        id: `perf-gift-product-${i}`,
        sku: `GIFT-${i}`,
        title: `Perf Gift Product ${i}`,
      }))
    }
    // CatalogProductPrice (per-line price-row fetch) and CartPromotionApplication
    // (existing-applications read) both default to empty — the first a harmless stub
    // input to the already-stubbed `resolveLinePrice`, the second a clean "first evaluation,
    // nothing held yet" baseline (zero codes in use, so zero per-code reservation round
    // trips — a deliberate, documented simplification: this benchmark measures the
    // mapping/sync cost of 200 FRESH applied promotions, not the code-housekeeping loop,
    // which is a fixed, separately-bounded per-code cost unrelated to the 200x50 scale this
    // gate is about).
    return []
  })
})

describe('cart.reprice promotions-phase performance (Step 7.6, TC-CART-PROM-07)', () => {
  it(`buildCartLineRepricePhases + buildPromotionsEffectsPhase + buildRecomputeCartTotalsPhase process ${PROMOTION_COUNT} promotions x ${LINE_COUNT} lines with P95 <= ${P95_BUDGET_MS}ms`, async () => {
    const durationsMs: number[] = []
    let sanityCheckedEffectCount = false

    for (let run = 0; run < SAMPLE_RUNS; run += 1) {
      const cart = makeCart()
      const lines = makeLines(LINE_COUNT)
      const appliedPromotions = buildAppliedPromotions(lines)
      if (!sanityCheckedEffectCount) {
        expect(appliedPromotions.length).toBe(PROMOTION_COUNT)
        sanityCheckedEffectCount = true
      }
      const em = makeEm()
      const container = makeContainer(appliedPromotions)

      const changes: CartPriceChange[] = []
      const touched: CartLine[] = []
      const adjustments: SalesAdjustmentDraft[] = []
      const warnings: CartPromotionWarning[] = []
      const createdGiftLines: CartLine[] = []
      const removedGiftLines: CartLine[] = []
      const now = new Date('2026-10-15T00:00:00.000Z')

      const startedAt = performance.now()

      const repricePhases = buildCartLineRepricePhases(em, container, cart, lines, 'promotion_applied', now, changes, touched)
      for (const phase of repricePhases) await phase()

      const promotionsPhase = buildPromotionsEffectsPhase({
        em,
        container,
        cart,
        lines,
        assortmentScope: undefined,
        tenantScope: { tenantId: TENANT_ID, organizationId: ORG_ID },
        now,
        adjustments,
        warnings,
        createdGiftLines,
        removedGiftLines,
      })
      await promotionsPhase()

      const totalsPhase = buildRecomputeCartTotalsPhase(container, cart, lines, now, changes, adjustments)
      await totalsPhase()

      durationsMs.push(performance.now() - startedAt)

      // Sanity-checks the benchmark actually exercised the full mapping, not a
      // short-circuited no-op path, on at least the first run.
      if (run === 0) {
        expect(createdGiftLines.length).toBe(GIFT_PRODUCT_COUNT)
        expect(lines.length).toBe(LINE_COUNT + GIFT_PRODUCT_COUNT)
      }
    }

    const p95 = computeP95(durationsMs)
    console.log(
      `[cart-reprice-promotions-performance] ${PROMOTION_COUNT}x${LINE_COUNT} P95=${p95.toFixed(3)}ms ` +
        `(min=${Math.min(...durationsMs).toFixed(3)}ms, max=${Math.max(...durationsMs).toFixed(3)}ms, runs=${SAMPLE_RUNS})`,
    )

    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS)
  })
})
