import { DefaultCatalogPricingService } from '../catalogPricingService'
import { resolveCatalogPrice, type PriceRow, type PricingContext } from '../../lib/pricing'

jest.mock('../../lib/pricing', () => ({
  resolveCatalogPrice: jest.fn(),
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
})
