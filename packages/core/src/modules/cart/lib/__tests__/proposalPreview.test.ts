// Step 3.4 (§7a.4) — `buildProposalAcceptancePreview`. Fake-store coverage, same spirit as
// `commands/__tests__/proposal.test.ts`'s own mocking of `findWithDecryption`: no real
// database, a fully-controlled fake `catalogScopedProductService`/`catalogBuyerPricingService`.
// Proves the preview's OWN contract — priced against the TARGET's current context (never the
// proposal's stale snapshot, never the author's), visibility re-checked, and ZERO writes
// (TC-CART-PROP-10) — not `evaluateCartVisibility`'s own algebra (covered by
// `lib/__tests__/visibility.test.ts`).

type Row = Record<string, any>

let seededCartLines: Row[] = []

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Row) => {
  if (entity === CartLine) {
    return seededCartLines.filter((row) => Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      return row[key] === (value ?? null)
    }))
  }
  // `fetchPriceRowsBatch`'s own `CatalogProductPrice` query — the pricing SERVICE itself
  // is mocked below, so this just needs to return a non-empty row per product so
  // `resolveLinePricing` is reached at all (same simplification `commands/__tests__/
  // proposal.test.ts` uses for its own `CatalogProductPrice` fixture).
  return [{ id: 'price-row-1' }]
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Row])),
}))

import { CartLine } from '../../data/entities'
import { Cart } from '../../data/entities'
import { buildProposalAcceptancePreview } from '../proposalPreview'

const TENANT_ID = 'tenant-preview-1'
const ORG_ID = 'org-preview-1'

function makeCartFixture(overrides: Row = {}): Cart {
  const now = new Date('2026-03-01T00:00:00.000Z')
  return {
    id: 'target-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    channel: 'api',
    customerId: 'customer-1',
    customerIds: ['customer-1'],
    customerGroupIds: ['group-1'],
    currencyCode: 'USD',
    priceKindId: null,
    updatedAt: now,
    ...overrides,
  } as unknown as Cart
}

function makeLineFixture(overrides: Row = {}): Row {
  return {
    id: 'proposal-line-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: 'proposal-1',
    productId: 'product-1',
    variantId: null,
    quantity: '2',
    unitPriceNet: '8',
    unitPriceGross: '9.6',
    deletedAt: null,
    ...overrides,
  }
}

function makeContainer(opts: { priceRow?: any; catalogScopedProductService?: unknown } = {}) {
  return {
    resolve: (name: string): any => {
      if (name === 'catalogBuyerPricingService') {
        return {
          resolveLinePrice: jest.fn(async () => opts.priceRow ?? { priceRow: { id: 'price-row-1' }, amountNet: 12, amountGross: 14.4, taxRatePercent: 20 }),
        }
      }
      if (name === 'catalogScopedProductService') {
        return (
          opts.catalogScopedProductService ?? {
            loadScopedProducts: jest.fn(async (_em: unknown, ids: string[]) => {
              const result = new Map()
              for (const id of ids) result.set(id, { id, categoryIds: [], tagIds: [], isActive: true })
              return result
            }),
          }
        )
      }
      throw new Error(`Unexpected DI token: ${name}`)
    },
  }
}

const EM = {} as any

beforeEach(() => {
  jest.clearAllMocks()
  seededCartLines = [makeLineFixture()]
})

describe('buildProposalAcceptancePreview', () => {
  it('re-prices against the TARGET\'s current context, never the proposal\'s own stale snapshot', async () => {
    const target = makeCartFixture()
    const proposal = makeCartFixture({ id: 'proposal-1', updatedAt: new Date('2026-03-01T01:00:00.000Z') })
    const container = makeContainer()

    const preview = await buildProposalAcceptancePreview({
      em: EM,
      container,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      target,
      proposal,
      assortmentScope: undefined,
    })

    expect(preview.proposalCartId).toBe('proposal-1')
    expect(preview.targetCartId).toBe('target-1')
    expect(preview.lines).toHaveLength(1)
    expect(preview.lines[0]).toMatchObject({
      proposalLineId: 'proposal-line-1',
      proposedUnitPriceNet: '8',
      proposedUnitPriceGross: '9.6',
      currentUnitPriceNet: '12',
      currentUnitPriceGross: '14.4',
      rejected: false,
    })
  })

  it('creates nothing — no em.persist/flush call anywhere in this function', async () => {
    const persist = jest.fn()
    const flush = jest.fn()
    const em = { persist, flush } as any
    const target = makeCartFixture()
    const proposal = makeCartFixture({ id: 'proposal-1' })

    await buildProposalAcceptancePreview({
      em,
      container: makeContainer(),
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      target,
      proposal,
      assortmentScope: undefined,
    })

    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('marks a visibility-rejected line with reason product_unavailable and no current price', async () => {
    const target = makeCartFixture()
    const proposal = makeCartFixture({ id: 'proposal-1' })
    const container = makeContainer({
      catalogScopedProductService: {
        loadScopedProducts: jest.fn(async () => new Map([['product-1', { id: 'product-1', categoryIds: ['blocked'], tagIds: [], isActive: true }]])),
      },
    })

    const preview = await buildProposalAcceptancePreview({
      em: EM,
      container,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      target,
      proposal,
      assortmentScope: [{ categoryIds: ['allowed'], tagIds: [] }],
    })

    expect(preview.lines[0]).toMatchObject({
      rejected: true,
      reason: 'product_unavailable',
      currentUnitPriceNet: null,
      currentUnitPriceGross: null,
    })
  })

  it('marks a line whose price cannot be resolved for this buyer as rejected too', async () => {
    const target = makeCartFixture()
    const proposal = makeCartFixture({ id: 'proposal-1' })
    const container = makeContainer({ priceRow: { priceRow: null, amountNet: null, amountGross: null, taxRatePercent: null } })

    const preview = await buildProposalAcceptancePreview({
      em: EM,
      container,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      target,
      proposal,
      assortmentScope: undefined,
    })

    expect(preview.lines[0]).toMatchObject({ rejected: true, reason: 'product_unavailable' })
  })

  it('returns an empty line list for a proposal with no (live) lines', async () => {
    seededCartLines = []
    const target = makeCartFixture()
    const proposal = makeCartFixture({ id: 'proposal-1' })

    const preview = await buildProposalAcceptancePreview({
      em: EM,
      container: makeContainer(),
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      target,
      proposal,
      assortmentScope: undefined,
    })

    expect(preview.lines).toEqual([])
  })
})
