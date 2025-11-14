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
    kind: 'list',
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
    const rows: PriceRow[] = [
      baseRow({ id: 'base', minQuantity: 1, kind: 'list' }),
      baseRow({
        id: 'variant-price',
        variant: { id: 'variant-1' } as any,
        kind: 'sale',
        channelId: 'channel-1',
        startsAt: new Date('2024-01-15T00:00:00Z'),
      }),
      baseRow({
        id: 'older-variant',
        variant: { id: 'variant-1' } as any,
        kind: 'sale',
        channelId: 'channel-1',
        startsAt: new Date('2024-01-01T00:00:00Z'),
        minQuantity: 5,
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

  it('allows event bus hooks to short-circuit and override pricing', async () => {
    const rows: PriceRow[] = [baseRow({ id: 'initial' })]
    const overridden = baseRow({ id: 'overridden' })
    const afterOverride = baseRow({ id: 'after-override' })

    const emitEvent = jest.fn().mockImplementation(async (event: string, payload: any) => {
      if (event === 'catalog.pricing.resolve.before') {
        payload.setRows([overridden])
        payload.setContext({ ...ctx, quantity: 5 })
        payload.setResult(overridden)
      }
      if (event === 'catalog.pricing.resolve.after') {
        expect(payload.rows).toEqual([overridden])
        expect(payload.context.quantity).toBe(5)
        expect(payload.result).toBe(overridden)
        payload.setResult(afterOverride)
      }
    })

    const result = await resolveCatalogPrice(rows, ctx, { eventBus: { emitEvent } as any })

    expect(emitEvent).toHaveBeenCalledTimes(2)
    expect(result).toBe(afterOverride)
  })
})
