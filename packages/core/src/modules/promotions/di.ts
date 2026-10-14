import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PromotionCacheService } from './services/promotion-cache'

export function register(container: AppContainer) {
  container.register({
    // `createRequestContainer()` builds a fresh `AppContainer` per request and calls
    // every module's `register(container)` on it, so closing over `container` here
    // (rather than destructuring a cradle) resolves `em`/`cache` from the SAME
    // request-scoped container at call time — matching how commands resolve them
    // (`ctx.container.resolve('em')`, see `commands/promotions.ts`).
    promotionCacheService: asFunction(() => new PromotionCacheService(container)).scoped().proxy(),
  })
}
