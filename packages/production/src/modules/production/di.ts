import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StockLedgerService } from './services/stockLedgerService.js'

/**
 * Production module DI registration.
 *
 * `productionStockProvider` (spec decision i) resolves to the module-owned
 * stock ledger service. Only the `ProductionStockProvider` interface + the
 * `production.stock_movement.created` event are contract surfaces — a future
 * warehouse module can register a different implementation under this same
 * token (extraction path documented in the spec).
 */
export function register(container: AppContainer) {
  container.register({
    productionStockProvider: asClass(StockLedgerService)
      .singleton()
      .inject(() => ({
        em: () => container.resolve('em'),
        dataEngine: container.resolve('dataEngine'),
      })),
  })
}
