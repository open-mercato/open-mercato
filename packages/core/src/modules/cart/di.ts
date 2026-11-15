import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CartServiceImpl } from './lib/cartService'

// Step 7.5 — the ONE new DI service this module gets: `cartService`, a thin facade over
// `cart.lock`/`.unlock`/`.markConverted`. See `lib/cartService.ts`'s own header comment for
// why this exists at all (the spec's own prose names `cartService.lock(...)` as the call
// shape a future `checkout` module reaches for, but nothing in this module builds a real
// "cartService" class otherwise — every other capability here is a plain command dispatched
// via `commandBus.execute(...)`).
export function register(container: AppContainer): void {
  container.register({
    // Same closure-over-`container` pattern as `promotions/di.ts`'s `promotionsService`:
    // resolves `commandBus` from the SAME request-scoped container at call time, not at
    // registration time.
    cartService: asFunction(() => new CartServiceImpl(container)).scoped().proxy(),
  })
}

export default { register }
