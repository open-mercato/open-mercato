import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PromotionCacheService } from './services/promotion-cache'
import { PromotionCodeGenerationService } from './services/code-generation'
import { PromotionCodeService } from './lib/code-service'
import { PromotionUsageService } from './lib/promotion-usage-service'
import { PromotionsServiceImpl } from './lib/promotions-service'

export function register(container: AppContainer) {
  container.register({
    // `createRequestContainer()` builds a fresh `AppContainer` per request and calls
    // every module's `register(container)` on it, so closing over `container` here
    // (rather than destructuring a cradle) resolves `em`/`cache` from the SAME
    // request-scoped container at call time — matching how commands resolve them
    // (`ctx.container.resolve('em')`, see `commands/promotions.ts`).
    promotionCacheService: asFunction(() => new PromotionCacheService(container)).scoped().proxy(),
    // SPEC-055 §Release 4 Contract Freeze — the frozen `promotionCodeService` DI token.
    // Same closure-over-`container` pattern as the siblings here, so rate limiting
    // (`rateLimiterService`) resolves from the SAME request-scoped container at call
    // time. Used by `commands/codes.ts` and `lib/promotions-service.ts`'s
    // `extendReservation`/`validateCode` (the two §A.2a methods that call it directly,
    // never through a command).
    promotionCodeService: asFunction(() => new PromotionCodeService(container)).scoped().proxy(),
    // SPEC-055 §Implementation Plan Phase 3 Step 6 (Release 4 PLAN.md Step 6.4) — the
    // frozen `promotionCodeGenerationService` DI token. No container dependency of its
    // own (it only enqueues onto the module-level `promotions-code-generate` queue) but
    // `.scoped()` for consistency with its siblings here.
    promotionCodeGenerationService: asFunction(() => new PromotionCodeGenerationService()).scoped().proxy(),
    // SPEC-055 §Release 4 Contract Freeze / §Promotion Usage Lifecycle — the frozen
    // `promotionUsageService` DI token (Step 6.3). No container dependency of its own
    // (unlike `promotionCodeService`'s rate limiter) — `commands/usage.ts` and this
    // module's events are resolved/imported directly — but still `.scoped()` for
    // consistency with its siblings here and in case a future need (e.g. rate limiting)
    // arises.
    promotionUsageService: asFunction(() => new PromotionUsageService()).scoped().proxy(),
    // SPEC-055 §Amendment A.2 — the primary in-process integration facade. Same
    // closure-over-`container` pattern as `promotionCacheService` above, so `evaluate`/
    // `evaluateForProduct` resolve `em`/`promotionCacheService`/`auth` from the SAME
    // request-scoped container at call time.
    promotionsService: asFunction(() => new PromotionsServiceImpl(container)).scoped().proxy(),
  })
}
