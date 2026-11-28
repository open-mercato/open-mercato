import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction, asValue } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { registerIndexDocEnricher, validateIndexDocEnricher } from '@open-mercato/core/modules/query_index/lib/doc-enrichers'
import { DefaultCatalogPricingService, type CatalogPricingService } from './services/catalogPricingService'
import { DefaultCatalogOmnibusService } from './services/catalogOmnibusService'
import { DefaultCatalogBuyerPricingService } from './services/catalogBuyerPricingService'
import { DefaultCatalogScopedProductService } from './services/catalogScopedProductService'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from './data/entities'
import { catalogProductScopeKeysEnricher } from './lib/productScopeKeys'

type AppCradle = AppContainer['cradle'] & {
  eventBus?: EventBus | null
}

function softCradle<T>(cradle: AppCradle, name: string): T | null {
  try {
    const value = (cradle as Record<string, unknown>)[name]
    return value === undefined || value === null ? null : (value as T)
  } catch {
    return null
  }
}

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    registerIndexDocEnricher(catalogProductScopeKeysEnricher)
  }, () => validateIndexDocEnricher(catalogProductScopeKeysEnricher))
  container.register({
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    })
      .scoped()
      .proxy(),
    catalogOmnibusService: asFunction((cradle: AppCradle) => {
      return new DefaultCatalogOmnibusService(
        softCradle<ModuleConfigService>(cradle, 'moduleConfigService'),
        softCradle<CacheStrategy>(cradle, 'cache'),
      )
    })
      .scoped()
      .proxy(),
    catalogBuyerPricingService: asFunction((cradle: AppCradle) => {
      const pricingService = softCradle<CatalogPricingService>(cradle, 'catalogPricingService')
      if (!pricingService) {
        throw new Error('[internal] catalogBuyerPricingService requires catalogPricingService to be registered')
      }
      return new DefaultCatalogBuyerPricingService(pricingService)
    })
      .scoped()
      .proxy(),
    catalogScopedProductService: asFunction(() => new DefaultCatalogScopedProductService())
      .scoped()
      .proxy(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
    CatalogProductVariant: asValue(CatalogProductVariant),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
