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

/**
 * Applies decision 7's matrix (see PLAN.md § Key design decisions) for a
 * resolved policy override on top of the pure fallback.
 */
function applyOverride(override: CatalogOnlyPolicyOverride | null | undefined): AvailabilityItemResult {
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
    byItem[key] = applyOverride(overrides[key])
  }

  return { byItem }
}

availabilityProviderRegistry.register({
  id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
  getAvailability,
})
