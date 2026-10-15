// Step 4.8 — queue names for the four §12 sweepers, following this module's own `cart:` id
// prefix convention (see `commands/cart.ts`'s `cart.create`/`cart.get`, `events.ts`'s
// `cart.*`). Auto-discovered from each `workers/*.ts`'s own `metadata.queue`; also used as
// `targetQueue` by `lib/scheduling.ts`'s scheduler registrations so both sides name the same
// queue from one place.
export const CART_MARK_ABANDONED_QUEUE = 'cart:mark-abandoned'
export const CART_EXPIRE_QUEUE = 'cart:expire'
export const CART_RELEASE_STALE_LOCKS_QUEUE = 'cart:release-stale-locks'
export const CART_PURGE_EXPIRED_QUEUE = 'cart:purge-expired'
