import type { EventBus } from '@open-mercato/events'
import {
  resolveCatalogPrice,
  type PriceRow,
  type PricingContext,
} from '../lib/pricing'

export type PersonalizationMeta = {
  isPersonalized: boolean
  personalizationReason: string | null
}

export function detectPersonalization(row: PriceRow | null): PersonalizationMeta {
  if (!row) return { isPersonalized: false, personalizationReason: null }
  if (row.userId != null) return { isPersonalized: true, personalizationReason: 'loyalty_tier' }
  if (row.customerId != null) return { isPersonalized: true, personalizationReason: 'negotiated_price' }
  if (row.userGroupId != null) return { isPersonalized: true, personalizationReason: 'customer_group' }
  if (row.customerGroupId != null) return { isPersonalized: true, personalizationReason: 'customer_group' }
  return { isPersonalized: false, personalizationReason: null }
}

export interface CatalogPricingService {
  resolvePrice(rows: PriceRow[], context: PricingContext): Promise<PriceRow | null>
}

export class DefaultCatalogPricingService implements CatalogPricingService {
  constructor(private readonly eventBus?: EventBus | null) {}

  async resolvePrice(rows: PriceRow[], context: PricingContext): Promise<PriceRow | null> {
    return resolveCatalogPrice(rows, context, { eventBus: this.eventBus })
  }
}

export type { PriceRow, PricingContext }
