import { DefaultSalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { SalesDocumentAmounts, SalesLineSnapshot } from '@open-mercato/core/modules/sales/lib/types'
import { toCartTotalsLineSnapshot } from '../reprice'
import type { CartLine } from '../../data/entities'

// Step 5.4 — §3.2's "release invariant" (rev 9 — F3/D-R4-9): "the same `SalesLineSnapshot[]`
// plus the same `SalesAdjustmentDraft[]` produce equal `SalesDocumentAmounts` for
// `documentKind: 'quote'` and `documentKind: 'order'`, compared as 4-decimal-place numerics
// per key (never byte-for-byte, which JSON doubles vs `numeric(18,4)` make untestable)."
//
// This is the Phase 2 gate's cut of that invariant (§14/§15 — "the totals-equivalence
// property test without promotions"): it calls the REAL `DefaultSalesCalculationService` (the
// same one `lib/reprice.ts`'s `buildRecomputeCartTotalsPhase` resolves from DI in production,
// instantiated directly here the same way `sales/services/__tests__/salesCalculationService.test.ts`
// and half a dozen `sales/commands/__tests__/*.test.ts` already do for a dependency-free unit
// test) twice per generated case — once per `documentKind` — with the IDENTICAL
// `SalesLineSnapshot[]` and `adjustments: []` both times. Building a real `SalesOrder` through
// the `sales` create command against an order assembled from the cart's own lines is the
// Phase 3 gate's job (§3.2's own distinction), once promotions exist to make `quote` and
// `order` diverge in a way worth testing against that heavier path — `calculateDocumentTotals`
// itself never branches on `documentKind` at all today (confirmed by reading
// `sales/lib/calculations.ts`: `buildBaseLineResult`/`buildBaseDocumentResult` take no
// `documentKind` parameter), so this test is also the regression guard for the day a
// document-kind-specific calculator hook makes that stop being true.
//
// Property-test style matches this repo's existing precedent,
// `catalog/lib/__tests__/buildPriceRowFilter.property.test.ts`: a seeded, dependency-free
// `mulberry32` PRNG over pooled values (not `fast-check`, which is not a devDependency here —
// see that file's own header comment), rather than one-off fixtures.

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20261015
const ITERATIONS = 500

// "Compound rates" (21.3, 13.75, 7.7) alongside plain round rates and 0 — deliberately NOT a
// uniform continuous draw, so every generated case is one of a known, reproducible set.
const TAX_RATE_POOL = [0, 5, 5.5, 7, 7.7, 8, 13.75, 19, 20, 21.3, 23]
// Rounding-boundary unit prices: none divide evenly by small quantities or by 100.
const UNIT_PRICE_POOL = ['10.33', '7.77', '19.99', '3.33', '0.19', '99.95', '1234.5699', '2.9999', '0.07']
// "Non-dividing quantity" generator (not a fixed fixture) — primes, so `unitPriceNet *
// quantity` essentially never lands on a clean 2-decimal total against the price pool above.
const QUANTITY_POOL = [3, 7, 11, 13, 17, 23]

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]
}

function roundTo4(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4
}

// §3.2's own comparison rule: 4-decimal-place numerics per key, never byte-for-byte.
function diffAt4dp(a: SalesDocumentAmounts, b: SalesDocumentAmounts): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SalesDocumentAmounts>
  const diffs: string[] = []
  for (const key of keys) {
    const av = roundTo4(Number(a[key] ?? 0))
    const bv = roundTo4(Number(b[key] ?? 0))
    if (av !== bv) diffs.push(`${key}: quote=${av} order=${bv}`)
  }
  return diffs
}

function makeFakeCartLine(overrides: Partial<CartLine> & Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    cartId: 'cart-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    productId: 'product-1',
    variantId: null,
    name: 'Widget',
    quantity: '1',
    quantityUnit: null,
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    discountTotalNet: null,
    configuration: null,
    ...overrides,
  } as CartLine
}

type GeneratedCase = {
  snapshots: SalesLineSnapshot[]
  quoteTotals: SalesDocumentAmounts
  orderTotals: SalesDocumentAmounts
}

describe('cart totals equivalence (property-based, TC-CART-TOT-01)', () => {
  it(`quote and order documentKinds produce equal totals (4dp) over ${ITERATIONS} generated tax-rate/quantity cases, built via toCartTotalsLineSnapshot from identical snapshots`, async () => {
    const service = new DefaultSalesCalculationService()
    const rng = mulberry32(SEED)
    const context = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }
    let firstExample: GeneratedCase | null = null
    let mixedRateCartSeen = false

    for (let i = 0; i < ITERATIONS; i += 1) {
      // 1-4 lines per cart — "mixed rates within one cart" needs more than one line to mean
      // anything; each line independently draws its own tax rate from the pool below.
      const lineCount = 1 + Math.floor(rng() * 4)
      const fakeLines: CartLine[] = []
      const rateSeen = new Set<number>()
      for (let j = 0; j < lineCount; j += 1) {
        const taxRate = pick(rng, TAX_RATE_POOL)
        rateSeen.add(taxRate)
        const unitPriceNet = pick(rng, UNIT_PRICE_POOL)
        const quantity = pick(rng, QUANTITY_POOL)
        // Gross kept consistent with net/taxRate so each generated line is a realistic
        // snapshot, even though the invariant under test does not depend on that consistency.
        const unitPriceGross = (Number(unitPriceNet) * (1 + taxRate / 100)).toFixed(4)
        fakeLines.push(
          makeFakeCartLine({
            id: `line-${i}-${j}`,
            productId: `product-${i}-${j}`,
            quantity: String(quantity),
            unitPriceNet,
            unitPriceGross,
            taxRate: String(taxRate),
          }),
        )
      }
      if (rateSeen.size > 1) mixedRateCartSeen = true

      // The IDENTICAL SalesLineSnapshot[] reference is passed to both calls below — §3.2's
      // own wording ("the same SalesLineSnapshot[] ... produce equal SalesDocumentAmounts").
      const snapshots = fakeLines.map((line) => toCartTotalsLineSnapshot(line, 'USD'))

      const quoteResult = await service.calculateDocumentTotals({
        documentKind: 'quote',
        lines: snapshots,
        adjustments: [],
        context,
      })
      const orderResult = await service.calculateDocumentTotals({
        documentKind: 'order',
        lines: snapshots,
        adjustments: [],
        context,
      })

      const diffs = diffAt4dp(quoteResult.totals, orderResult.totals)
      if (diffs.length > 0) {
        throw new Error(
          `Totals-equivalence violation at iteration ${i}: ${diffs.join('; ')}\n` +
            `snapshots=${JSON.stringify(snapshots)}`,
        )
      }

      if (!firstExample) {
        firstExample = { snapshots, quoteTotals: quoteResult.totals, orderTotals: orderResult.totals }
      }
    }

    // A generation scheme that never produced a mixed-rate cart, or never ran, would make the
    // loop above vacuously uninteresting — guard against that regressing silently.
    expect(mixedRateCartSeen).toBe(true)
    expect(firstExample).not.toBeNull()
    expect(firstExample!.quoteTotals).toEqual(firstExample!.orderTotals)
  })

  // TC-CART-TOT-03/04 regression guard, exercised through the REAL calculation engine (not
  // just the mapper-level assertion in `reprice.test.ts`): a line-scope discount reaches
  // `calculateDocumentTotals` as `discountAmount`/`discountAmountBasis: 'line'`, taken as-is —
  // never divided by quantity (rev 8's withdrawn per-unit rule) — and the quote/order
  // equivalence still holds with a discount in play. No `promotionsService` integration exists
  // in this worktree yet (Phase 3/7); this synthesizes what a future promotion-applied
  // `CartLine.discountTotalNet` would look like, per §3.2 rule 1 and §4.2's column doc.
  it('a line-scope discount (discountTotalNet) reaches the engine undivided and totals still agree across documentKinds', async () => {
    const service = new DefaultSalesCalculationService()
    const context = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }

    // 5 units at 10.00 net, 20% tax, with a line-total discount of 12.40 covering some of
    // those units. If this were wrongly divided by quantity (rev 8's bug), the discount
    // reaching `sales` would be 2.48, not 12.40.
    const line = makeFakeCartLine({ quantity: '5', unitPriceNet: '10', unitPriceGross: '12', taxRate: '20', discountTotalNet: '-12.40' })
    const snapshot = toCartTotalsLineSnapshot(line, 'USD')
    expect(snapshot.discountAmountBasis).toBe('line')
    expect(snapshot.discountAmount).toBe(12.4)

    const snapshots = [snapshot]
    const quoteResult = await service.calculateDocumentTotals({ documentKind: 'quote', lines: snapshots, adjustments: [], context })
    const orderResult = await service.calculateDocumentTotals({ documentKind: 'order', lines: snapshots, adjustments: [], context })

    expect(quoteResult.totals.discountTotalAmount).toBe(12.4)
    expect(quoteResult.totals.discountTotalAmount).not.toBeCloseTo(12.4 / 5)
    expect(diffAt4dp(quoteResult.totals, orderResult.totals)).toEqual([])
  })
})
