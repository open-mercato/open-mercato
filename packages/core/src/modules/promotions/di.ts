import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PromotionCacheService } from './services/promotion-cache'
import { PromotionCodeGenerationService } from './services/code-generation'
import { PromotionCodeService } from './lib/code-service'
import { PromotionUsageService } from './lib/promotion-usage-service'
import { PromotionsServiceImpl } from './lib/promotions-service'

export function register(container: AppContainer) {
  container.register({
    promotionCacheService: asScopedService((scope) => new PromotionCacheService(scope)),
    promotionCodeService: asScopedService((scope) => new PromotionCodeService(scope)),
    promotionCodeGenerationService: asFunction(() => new PromotionCodeGenerationService()).scoped().proxy(),
    promotionUsageService: asFunction(() => new PromotionUsageService()).scoped().proxy(),
    promotionsService: asScopedService((scope) => new PromotionsServiceImpl(scope)),
  })
}

defineProcessDiRegistrar(register)
