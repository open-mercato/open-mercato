import { asFunction, asValue } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { registerIndexDocEnricher } from '@open-mercato/core/modules/query_index/lib/doc-enrichers'
import { DefaultCatalogPricingService, type CatalogPricingService } from './services/catalogPricingService'
import { DefaultCatalogOmnibusService } from './services/catalogOmnibusService'
import { DefaultCatalogBuyerPricingService } from './services/catalogBuyerPricingService'
import { DefaultCatalogScopedProductService } from './services/catalogScopedProductService'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from './data/entities'
import { catalogProductScopeKeysEnricher } from './lib/productScopeKeys'
import { createCatalogCategorizationService } from './lib/aiCategorization/categorizationService'
import type { CatalogDecisionModelPort } from './lib/aiCategorization/decisionModelPort'

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

export function register(container: AppContainer) {
  registerIndexDocEnricher(catalogProductScopeKeysEnricher)
  container.register({
    catalogPricingService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultCatalogPricingService(eventBus ?? null)
    })
      .singleton()
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
      .singleton()
      .proxy(),
    catalogScopedProductService: asFunction(() => new DefaultCatalogScopedProductService())
      .singleton()
      .proxy(),
    catalogCategorizationService: asFunction((cradle: AppCradle) => {
      const configService = softCradle<ModuleConfigService>(cradle, 'moduleConfigService')
      if (!configService) {
        throw new Error('[internal] catalogCategorizationService requires moduleConfigService to be registered')
      }
      const decisionModelPort = softCradle<CatalogDecisionModelPort>(cradle, 'decisionModelService')
      return createCatalogCategorizationService({ configService, decisionModelPort })
    })
      .scoped()
      .proxy(),
    CatalogProduct: asValue(CatalogProduct),
    CatalogProductPrice: asValue(CatalogProductPrice),
    CatalogProductVariant: asValue(CatalogProductVariant),
  })
}
