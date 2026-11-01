import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CustomerPurchaseApprovalService } from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import type { CartCodeServiceLike } from './sweepers'

// Step 2.10 (K6/§10.2) — the two hand-written admin routes (`/carts/[id]`,
// `/carts/[id]/reprice`) need the SAME `organizationIds` derivation `makeCrudRoute` already
// applies internally to the list route (`api/carts/route.ts`) for a multi-org caller, but a
// hand-written route resolves its own `OrganizationScope` and has no factory to derive it
// for it. Reimplemented locally rather than imported from `customer_groups/lib/
// customerScope.ts#organizationIdsFromScope` (module-private, and root AGENTS.md forbids a
// cross-module import of another module's internal `lib/` helper) — same algorithm, the
// second module in this codebase to need it (the first being `customer_groups` itself).

/**
 * Derives the caller's allowed `organizationId`s from a resolved `OrganizationScope`, the
 * same way `makeCrudRoute`'s own `resolveListContext` derives `ctx.organizationIds`. `null`
 * means unrestricted (no organization filter at all — a superadmin with no selected
 * organization); an empty array means "nothing is visible."
 */
export function organizationIdsFromCartScope(
  scope: OrganizationScope | null,
  fallbackOrganizationId: string | null,
): string[] | null {
  if (!scope) return fallbackOrganizationId ? [fallbackOrganizationId] : null
  const filterIds = Array.isArray(scope.filterIds)
    ? scope.filterIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  if (filterIds === null) {
    if (scope.allowedIds === null) return null
    return fallbackOrganizationId ? [fallbackOrganizationId] : null
  }
  if (filterIds.length > 0) return Array.from(new Set(filterIds))
  if (!fallbackOrganizationId) return []
  const allowedIds = Array.isArray(scope.allowedIds) ? scope.allowedIds : null
  if (allowedIds === null || allowedIds.length === 0 || allowedIds.includes(fallbackOrganizationId)) {
    return [fallbackOrganizationId]
  }
  return []
}

/**
 * §10.2's live approval read: `customer_groups` is a HARD dependency of `cart` (`index.ts`'s
 * `requires`), so `customerPurchaseApprovalService` is always registered in practice — but
 * the task's own brief and K6's text both call for resolving it defensively via `tryResolve`
 * anyway ("`null` with no error when `customer_groups`' approval service is absent"), the
 * same soft-DI shape every OTHER optional peer in this module already uses
 * (`tryResolveStoreContextService` in `lib/routeContext.ts`/`commands/cart.ts`). Costs
 * nothing and degrades gracefully if that ever changes.
 */
export function tryResolveCustomerPurchaseApprovalService(container: {
  resolve: <T = unknown>(name: string) => T
}): CustomerPurchaseApprovalService | null {
  try {
    return container.resolve<CustomerPurchaseApprovalService>('customerPurchaseApprovalService') ?? null
  } catch {
    return null
  }
}

/**
 * Step 6.1 (K11 gap-fill) — `promotions` is a HARD dependency of `cart` (`index.ts`'s
 * `requires`, same as `customer_groups` above), so `promotionCodeService` is always
 * registered in practice too, but `lib/sweepers.ts#releaseCartCodeReservations`'s own
 * callers (the sweep workers) resolve it via `ctx.resolve` without a `try` — this helper
 * exists for the two command call sites (`commands/lock.ts#markConverted`,
 * `commands/merge.ts`'s absorbed-cart finalization) that need the SAME soft-DI degrade
 * `tryResolveCustomerPurchaseApprovalService` above already uses, since a command runs in
 * a request path rather than a worker's own fixed DI wiring.
 */
export function tryResolveCartCodeService(container: {
  resolve: <T = unknown>(name: string) => T
}): CartCodeServiceLike | null {
  try {
    return container.resolve<CartCodeServiceLike>('promotionCodeService') ?? null
  } catch {
    return null
  }
}
