/**
 * Per-module local soft-resolve helper — see `packages/core/AGENTS.md` § Cross-Module
 * Coupling. `checkout` declares no new `requires` (C10/D-R5-18): session features resolve
 * `cart`, `customer_groups`, `availability`, `promotions`, `shipping_carriers` and
 * `ecommerce` through this, never an unconditional `container.resolve(...)`.
 */
export function tryResolve<T>(resolver: { resolve: <R = unknown>(name: string) => R }, name: string): T | undefined {
  try {
    return resolver.resolve<T>(name)
  } catch {
    return undefined
  }
}
