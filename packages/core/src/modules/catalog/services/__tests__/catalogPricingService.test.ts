import { DefaultCatalogPricingService } from '../catalogPricingService'
import { resolveCatalogPrice, resolveCatalogPriceBatch, type PriceRow, type PricingContext } from '../../lib/pricing'

jest.mock('../../lib/pricing', () => ({
  resolveCatalogPrice: jest.fn(),
  resolveCatalogPriceBatch: jest.fn(),
}))

describe('DefaultCatalogPricingService', () => {
  it('delegates resolution to the shared pricing helper', async () => {
    const rows: PriceRow[] = []
    const context: PricingContext = { quantity: 1, date: new Date() }
    const eventBus = { emitEvent: jest.fn() }
    ;(resolveCatalogPrice as jest.Mock).mockResolvedValue({ id: 'best-price' })

    const service = new DefaultCatalogPricingService(eventBus as any)
    const result = await service.resolvePrice(rows, context)

    expect(resolveCatalogPrice).toHaveBeenCalledWith(rows, context, { eventBus })
    expect(result).toEqual({ id: 'best-price' })
  })

  it('delegates batch resolution to the shared batch pricing helper', async () => {
    const entries = [
      { rows: [] as PriceRow[], context: { quantity: 1, date: new Date() } as PricingContext },
      { rows: [] as PriceRow[], context: { quantity: 2, date: new Date() } as PricingContext },
    ]
    const eventBus = { emitEvent: jest.fn() }
    const expected = [{ id: 'price-1' }, null]
    ;(resolveCatalogPriceBatch as jest.Mock).mockResolvedValue(expected)

    const service = new DefaultCatalogPricingService(eventBus as any)
    const result = await service.resolvePriceMany(entries)

    expect(resolveCatalogPriceBatch).toHaveBeenCalledWith(entries, { eventBus })
    expect(result).toEqual(expected)
  })
})
