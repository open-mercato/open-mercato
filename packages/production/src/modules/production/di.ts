import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Production module DI registration.
 *
 * `productionStockProvider` (spec decision i) is registered here in Phase 2;
 * the registrar exists from the scaffold so wiring stays in one place.
 */
export function register(_container: AppContainer) {
  // No services yet — Phase 1 adds domain services, Phase 2 registers
  // productionStockProvider backed by the module-owned stock ledger.
}
