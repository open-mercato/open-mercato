import type { EventBus } from '@open-mercato/events'
import {
  resolveCatalogPrice,
  resolveCatalogPriceBatch,
  type PriceRow,
  type PricingContext,
} from '../lib/pricing'

export interface CatalogPricingService {
  resolvePrice(rows: PriceRow[], context: PricingContext): Promise<PriceRow | null>
  resolvePriceMany(entries: Array<{ rows: PriceRow[]; context: PricingContext }>): Promise<Array<PriceRow | null>>
}

export class DefaultCatalogPricingService implements CatalogPricingService {
  constructor(private readonly eventBus?: EventBus | null) {}

  async resolvePrice(rows: PriceRow[], context: PricingContext): Promise<PriceRow | null> {
    return resolveCatalogPrice(rows, context, { eventBus: this.eventBus })
  }

  async resolvePriceMany(entries: Array<{ rows: PriceRow[]; context: PricingContext }>): Promise<Array<PriceRow | null>> {
    return resolveCatalogPriceBatch(entries, { eventBus: this.eventBus })
  }
}

export type { PriceRow, PricingContext }
