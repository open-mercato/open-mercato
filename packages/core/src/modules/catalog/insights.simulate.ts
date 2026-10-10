import { defineSimulateConfig } from '@open-mercato/shared/modules/insights/simulate'
import { priceBacktestKind } from './lib/simulation/price-backtest'

/**
 * Change simulator contribution of catalog: the price backtest (`catalog.price_backtest`) replays a
 * new amount of an existing price row against the document lines recorded with that row. Catalog
 * owns the row (fingerprint, amount timeline); the line families are read by the sources other
 * modules register through `registerCatalogPriceLineSource` (sales: orders and quotes).
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  kinds: [priceBacktestKind],
})

export default simulateConfig
