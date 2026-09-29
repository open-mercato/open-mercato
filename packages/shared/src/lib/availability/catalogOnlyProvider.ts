/**
 * The built-in `catalog-only` fallback provider. Always registered so a
 * `wms`-less *and* `availability`-less storefront stays fully functional.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §4.3
 */

import { availabilityItemKey } from './types'
import type { AvailabilityItemResult, AvailabilityQuery, AvailabilityResult } from './types'
import { availabilityProviderRegistry, AVAILABILITY_CATALOG_ONLY_PROVIDER_ID } from './registry'

/** Per-item policy signal the optional lookup hook may report. */
export type CatalogOnlyPolicyOverride = {
  /** `true` → the item is explicitly opted into stock tracking with no data source behind it (§4.3, out_of_stock). */
  isStockManaged?: boolean
  /** `false` → the policy row is inactive; treated as out_of_stock. */
  isActive?: boolean
  /** ISO-8601. In the future → `preorder`. */
  preorderReleaseAt?: string | null
  /** Requested quantities below this cannot be fulfilled. */
  minOrderQuantity?: number | null
  /** Requested quantities above this cannot be fulfilled — a cap independent of stock. */
  maxOrderQuantity?: number | null
  /** Pack size; requested quantities must be a multiple. */
  quantityIncrement?: number | null
  /** The `AvailabilityPolicy` row id that produced this override. */
  policySourceId?: string | null
}

/**
 * Optional soft lookup into `AvailabilityPolicy` when the `availability`
 * module is installed. Keyed by `availabilityItemKey()`. Returning `null` or
 * omitting an item from the map means "no policy row — module default".
 */
export type CatalogOnlyPolicyLookup = (
  query: AvailabilityQuery,
) => Promise<Record<string, CatalogOnlyPolicyOverride | null | undefined>>

let policyLookup: CatalogOnlyPolicyLookup | null = null

/**
 * Wired by the `availability` module's `di.ts` at container-build time
 * (closure captures the container, mirroring `wms/di.ts`'s own provider
 * registration) — never a static import from `packages/shared`. Pass `null`
 * to clear (test isolation).
 */
export function setCatalogOnlyPolicyLookup(lookup: CatalogOnlyPolicyLookup | null): void {
  policyLookup = lookup
}

function pureFallbackItem(): AvailabilityItemResult {
  return {
    state: 'not_tracked',
    availableQuantity: null,
    canFulfil: true,
    leadTimeDays: null,
    releaseAt: null,
    isAuthoritative: true,
    policySourceId: null,
  }
}

function isWithinOrderQuantityRules(requested: number, override: CatalogOnlyPolicyOverride): boolean {
  const { minOrderQuantity, maxOrderQuantity, quantityIncrement } = override
  if (minOrderQuantity != null && requested < minOrderQuantity) return false
  if (maxOrderQuantity != null && requested > maxOrderQuantity) return false
  if (quantityIncrement != null && quantityIncrement > 0 && requested % quantityIncrement !== 0) return false
  return true
}

/**
 * Order-quantity rules are a cap independent of stock: a violation blocks
 * fulfilment without changing the state the policy matrix produced.
 */
function applyOverride(
  override: CatalogOnlyPolicyOverride | null | undefined,
  requestedQuantity: number,
): AvailabilityItemResult {
  const result = applyPolicyMatrix(override)
  if (!override || isWithinOrderQuantityRules(requestedQuantity, override)) return result
  return { ...result, canFulfil: false }
}

/**
 * Applies decision 7's matrix (see PLAN.md § Key design decisions) for a
 * resolved policy override on top of the pure fallback.
 */
function applyPolicyMatrix(override: CatalogOnlyPolicyOverride | null | undefined): AvailabilityItemResult {
  const base = pureFallbackItem()
  if (!override) return base

  const policySourceId = override.policySourceId ?? null

  if (override.preorderReleaseAt) {
    const releaseAt = new Date(override.preorderReleaseAt)
    if (!Number.isNaN(releaseAt.getTime()) && releaseAt.getTime() > Date.now()) {
      return {
        ...base,
        state: 'preorder',
        canFulfil: true,
        releaseAt: override.preorderReleaseAt,
        policySourceId,
      }
    }
  }

  if (override.isActive === false) {
    return { ...base, state: 'out_of_stock', canFulfil: false, policySourceId }
  }

  if (override.isStockManaged === true) {
    // Opted into stock tracking with no data source to verify against — see
    // decision 7: this is the "policy explicitly marks the item unavailable"
    // case rather than a silent "in stock" claim (R5).
    return { ...base, state: 'out_of_stock', canFulfil: false, policySourceId }
  }

  return { ...base, policySourceId }
}

async function getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
  const byItem: AvailabilityResult['byItem'] = {}

  let overrides: Record<string, CatalogOnlyPolicyOverride | null | undefined> = {}
  if (policyLookup) {
    try {
      overrides = await policyLookup(query)
    } catch {
      // Degrade gracefully to the pure fallback — never let an optional
      // policy lookup failure break the always-available fallback provider.
      overrides = {}
    }
  }

  for (const item of query.items) {
    const key = availabilityItemKey(item)
    byItem[key] = applyOverride(overrides[key], item.quantity)
  }

  return { byItem }
}

availabilityProviderRegistry.register({
  id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
  getAvailability,
})
