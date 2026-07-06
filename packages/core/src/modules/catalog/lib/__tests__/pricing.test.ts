import {
  resolvePriceVariantId,
  resolvePriceOfferId,
  resolvePriceChannelId,
  selectBestPrice,
  registerCatalogPricingResolver,
  resetCatalogPricingResolvers,
  resolveCatalogPrice,
  type PriceRow,
  type PricingContext,
} from '../pricing'

describe('catalog pricing helpers', () => {
  const baseRow = (overrides: Partial<PriceRow> = {}): PriceRow => ({
    id: overrides.id ?? 'price-id',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    currencyCode: 'USD',
    priceKind: { id: 'pk-regular', code: 'regular', isPromotion: false } as any,
    kind: 'regular',
    minQuantity: 1,
    unitPriceNet: '10.00',
    unitPriceGross: '12.30',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  })

  const ctx: PricingContext = {
    channelId: 'channel-1',
    offerId: null,
    userId: null,
    userGroupId: null,
    customerId: null,
    customerGroupId: null,
    quantity: 1,
    date: new Date('2024-02-01T00:00:00Z'),
  }

  beforeEach(() => {
    resetCatalogPricingResolvers()
  })

  afterEach(() => {
    resetCatalogPricingResolvers()
  })

  it('resolves price identifiers consistently', () => {
    const variantId = resolvePriceVariantId(baseRow({ variant: { id: 'variant-1' } as any }))
    const offerId = resolvePriceOfferId(baseRow({ offer: { id: 'offer-1' } as any }))
    const channelId = resolvePriceChannelId(baseRow({ offer: { channelId: 'channel-2' } as any }))

    expect(variantId).toBe('variant-1')
    expect(offerId).toBe('offer-1')
    expect(channelId).toBe('channel-2')
  })

  it('selects the highest scoring price with deterministic tie breakers', () => {
    // `base` has score 2 (regular kind, no scoping). Both variant rows share kind, variant,
    // and channel scoping so they tie at score 17 — verifying that scorePrice wins first
    // and `startsAt` (descending) breaks the remaining tie. `older-variant` keeps the
    // default `minQuantity` from `baseRow` so it passes `matchesContext` at `ctx.quantity=1`
    // and actually reaches the comparator (prior to this it carried `minQuantity: 5` and
    // was filtered out before the sort ran, leaving the tie-break code unexercised).
    const rows: PriceRow[] = [
      baseRow({ id: 'base', minQuantity: 1, kind: 'regular' }),
      baseRow({
        id: 'variant-price',
        variant: { id: 'variant-1' } as any,
        kind: 'promotion',
        priceKind: { id: 'pk-promo', code: 'promotion', isPromotion: true } as any,
        channelId: 'channel-1',
        startsAt: new Date('2024-01-15T00:00:00Z'),
      }),
      baseRow({
        id: 'older-variant',
        variant: { id: 'variant-1' } as any,
        kind: 'promotion',
        priceKind: { id: 'pk-promo', code: 'promotion', isPromotion: true } as any,
        channelId: 'channel-1',
        startsAt: new Date('2024-01-01T00:00:00Z'),
      }),
    ]

    const result = selectBestPrice(rows, ctx)
    expect(result?.id).toBe('variant-price')
  })

  it('applies resolver priority before falling back to default selection', async () => {
    const rows: PriceRow[] = [baseRow({ id: 'fallback' })]
    const customMatch = baseRow({ id: 'custom-match', kind: 'custom' })

    const lowPriority = jest.fn().mockResolvedValue(undefined)
    const highPriority = jest.fn().mockResolvedValue(customMatch)

    registerCatalogPricingResolver(lowPriority, { priority: 1 })
    registerCatalogPricingResolver(highPriority, { priority: 10 })

    const result = await resolveCatalogPrice(rows, ctx)

    expect(highPriority).toHaveBeenCalledWith(rows, ctx)
    expect(lowPriority).not.toHaveBeenCalled()
    expect(result).toBe(customMatch)
  })

  it('uses selectBestPrice when no resolver returns a result', async () => {
    const rows: PriceRow[] = [
      baseRow({ id: 'base', startsAt: new Date('2024-01-01T00:00:00Z') }),
      baseRow({ id: 'better', startsAt: new Date('2024-02-01T00:00:00Z'), variant: { id: 'v1' } as any }),
    ]

    registerCatalogPricingResolver(jest.fn().mockResolvedValue(undefined), { priority: 5 })

    const result = await resolveCatalogPrice(rows, ctx)
    expect(result?.id).toBe('better')
  })

  it('allows before hook to short-circuit the resolver pipeline', async () => {
    const rows: PriceRow[] = [baseRow({ id: 'initial' })]
    const overridden = baseRow({ id: 'overridden' })

    const emitEvent = jest.fn().mockImplementation(async (event: string, payload: any) => {
      if (event === 'catalog.pricing.resolve.before') {
        payload.setRows([overridden])
        payload.setContext({ ...ctx, quantity: 5 })
        payload.setResult(overridden)
      }
    })

    const result = await resolveCatalogPrice(rows, ctx, { eventBus: { emitEvent } as any })

    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(result).toBe(overridden)
  })

  it('invokes after hook so integrators can adjust the final result', async () => {
    const rows: PriceRow[] = [baseRow({ id: 'initial' })]
    const overridden = baseRow({ id: 'overridden' })

    const emitEvent = jest.fn().mockImplementation(async (event: string, payload: any) => {
      if (event === 'catalog.pricing.resolve.before') {
        payload.setRows(rows)
      }
      if (event === 'catalog.pricing.resolve.after') {
        expect(payload.result).toEqual(rows[0])
        payload.setResult(overridden)
      }
    })

    const result = await resolveCatalogPrice(rows, ctx, { eventBus: { emitEvent } as any })

    expect(emitEvent).toHaveBeenCalledTimes(2)
    expect(result).toBe(overridden)
  })

  it('breaks tier-pricing ties by selecting the higher minQuantity (volume discount semantic)', () => {
    // Mirrors the repro from issue #1706:
    // qty=3 with tiers minQty=2 ($9) and minQty=3 ($8) must resolve to the minQty=3 tier.
    const tierKind = { id: 'pk-tier', code: 'tier', isPromotion: false } as any
    const tierLow = baseRow({
      id: 'tier-low',
      kind: 'tier',
      minQuantity: 2,
      priceKind: tierKind,
      unitPriceNet: '9.00',
      unitPriceGross: '11.07',
    })
    const tierHigh = baseRow({
      id: 'tier-high',
      kind: 'tier',
      minQuantity: 3,
      priceKind: tierKind,
      unitPriceNet: '8.00',
      unitPriceGross: '9.84',
    })

    const result = selectBestPrice([tierLow, tierHigh], { ...ctx, quantity: 3 })

    expect(result?.id).toBe('tier-high')
  })

  it('keeps promotion over tier when scorePrice ties them across kinds', () => {
    // Regression guard for the #1706 fix: scorePrice gives `promotion` base=4 and `tier`
    // base=3 + 1 (bonus for minQuantity > 1). A promotion row with minQuantity=1 and a
    // tier row with minQuantity>=2 both end up at score=4 with no other scoping. Tie-break
    // on minQuantity must keep promotion (lower minQuantity) winning across kinds — the
    // descending direction introduced for #1706 only applies within the same kind.
    const promoKind = { id: 'pk-promo', code: 'promotion', isPromotion: true } as any
    const tierKind = { id: 'pk-tier', code: 'tier', isPromotion: false } as any
    const promo = baseRow({
      id: 'promo',
      kind: 'promotion',
      minQuantity: 1,
      priceKind: promoKind,
      unitPriceNet: '7.00',
      unitPriceGross: '8.61',
    })
    const tier = baseRow({
      id: 'tier',
      kind: 'tier',
      minQuantity: 3,
      priceKind: tierKind,
      unitPriceNet: '8.00',
      unitPriceGross: '9.84',
    })

    const result = selectBestPrice([promo, tier], { ...ctx, quantity: 5 })

    expect(result?.id).toBe('promo')
  })
})
