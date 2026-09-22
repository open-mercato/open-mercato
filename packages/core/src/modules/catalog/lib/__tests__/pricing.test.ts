import {
  resolvePriceVariantId,
  resolvePriceOfferId,
  resolvePriceChannelId,
  selectBestPrice,
  registerCatalogPricingResolver,
  resetCatalogPricingResolvers,
  resolveCatalogPrice,
  buildPriceRowFilter,
  type PriceRow,
  type PricingContext,
} from '../pricing'
import type * as PricingModule from '../pricing'

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

  it('shares resolver registrations across isolated module instances (globalThis scoping)', async () => {
    // Simulates the standalone-app / multi-chunk failure mode: a resolver
    // registered from one evaluation of `pricing.ts` must be visible to
    // resolution running against a second, independent evaluation — proving
    // the registry lives on `globalThis`, not in module-local state.
    let firstModule: typeof PricingModule | undefined
    let secondModule: typeof PricingModule | undefined

    jest.isolateModules(() => {
      firstModule = jest.requireActual<typeof PricingModule>('../pricing')
    })
    firstModule?.resetCatalogPricingResolvers()

    const marker = baseRow({ id: 'from-first-instance' })
    firstModule?.registerCatalogPricingResolver(async () => marker, {
      priority: 5,
      id: 'test-cross-instance-resolver',
    })

    jest.isolateModules(() => {
      secondModule = jest.requireActual<typeof PricingModule>('../pricing')
    })

    const result = await secondModule?.resolveCatalogPrice([baseRow({ id: 'other' })], ctx)
    expect(result?.id).toBe('from-first-instance')

    firstModule?.resetCatalogPricingResolvers()
  })

  it('skips re-registration when the same resolver id is already present', async () => {
    const first = jest.fn().mockResolvedValue(baseRow({ id: 'first' }))
    const second = jest.fn().mockResolvedValue(baseRow({ id: 'second' }))

    registerCatalogPricingResolver(first, { priority: 5, id: 'dedupe-test' })
    registerCatalogPricingResolver(second, { priority: 5, id: 'dedupe-test' })

    const result = await resolveCatalogPrice([baseRow({ id: 'fallback' })], ctx)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(result?.id).toBe('first')
  })

  it('filters by currencyCode only when the context specifies one', () => {
    const usdRow = baseRow({ id: 'usd', currencyCode: 'USD' })
    const eurRow = baseRow({ id: 'eur', currencyCode: 'EUR' })

    // Omitted currencyCode: unchanged legacy behavior — both rows match, no filtering.
    const noFilter = selectBestPrice([usdRow, eurRow], ctx)
    expect(noFilter).not.toBeNull()

    // Explicit currencyCode: only the matching row is a candidate.
    const eurOnly = selectBestPrice([usdRow, eurRow], { ...ctx, currencyCode: 'EUR' })
    expect(eurOnly?.id).toBe('eur')

    // No row in the requested currency: no match, not a silent cross-currency pick.
    const noMatch = selectBestPrice([usdRow], { ...ctx, currencyCode: 'EUR' })
    expect(noMatch).toBeNull()
  })

  it('matches customerGroupIds as set membership, with legacy customerGroupId still supported', () => {
    const groupRow = baseRow({ id: 'group-scoped', customerGroupId: 'group-b' })

    // New shape: set membership.
    expect(selectBestPrice([groupRow], { ...ctx, customerGroupIds: ['group-a', 'group-b'] })?.id).toBe('group-scoped')
    expect(selectBestPrice([groupRow], { ...ctx, customerGroupIds: ['group-a'] })).toBeNull()

    // Legacy shape: exact match, read as a one-element set when customerGroupIds is absent.
    expect(selectBestPrice([groupRow], { ...ctx, customerGroupId: 'group-b' })?.id).toBe('group-scoped')
    expect(selectBestPrice([groupRow], { ...ctx, customerGroupId: 'group-a' })).toBeNull()

    // customerGroupIds takes precedence over the legacy field when both are present.
    expect(
      selectBestPrice([groupRow], { ...ctx, customerGroupId: 'group-a', customerGroupIds: ['group-b'] })?.id,
    ).toBe('group-scoped')
  })

  it('buildPriceRowFilter narrows to unscoped-or-null rows when the context has no scope', () => {
    const filter = buildPriceRowFilter({ quantity: 1, date: new Date() }) as any
    expect(filter.$and).toEqual([
      { customerId: null },
      { customerGroupId: null },
      { userId: null },
      { userGroupId: null },
      { channelId: null },
    ])
  })

  it('buildPriceRowFilter admits null-or-matching rows for a scoped context', () => {
    const filter = buildPriceRowFilter({
      quantity: 1,
      date: new Date(),
      customerId: 'cust-1',
      customerGroupIds: ['group-a', 'group-b'],
      channelId: 'chan-1',
      currencyCode: 'USD',
    }) as any
    expect(filter.$and).toEqual([
      { $or: [{ customerId: null }, { customerId: 'cust-1' }] },
      { $or: [{ customerGroupId: null }, { customerGroupId: { $in: ['group-a', 'group-b'] } }] },
      { userId: null },
      { userGroupId: null },
      { $or: [{ channelId: null }, { channelId: 'chan-1' }] },
      { currencyCode: 'USD' },
    ])
  })

  it('buildPriceRowFilter reads the legacy customerGroupId as a one-element set', () => {
    const filter = buildPriceRowFilter({ quantity: 1, date: new Date(), customerGroupId: 'group-a' }) as any
    expect(filter.$and).toContainEqual({
      $or: [{ customerGroupId: null }, { customerGroupId: { $in: ['group-a'] } }],
    })
  })

  it('keeps stable registration order among resolvers at the same priority', async () => {
    const calls: string[] = []
    const resolverA = jest.fn().mockImplementation(async () => {
      calls.push('a')
      return undefined
    })
    const resolverB = jest.fn().mockImplementation(async () => {
      calls.push('b')
      return undefined
    })

    registerCatalogPricingResolver(resolverA, { priority: 5 })
    registerCatalogPricingResolver(resolverB, { priority: 5 })

    await resolveCatalogPrice([baseRow({ id: 'fallback' })], ctx)

    expect(calls).toEqual(['a', 'b'])
  })
})
