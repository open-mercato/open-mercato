/**
 * Availability Contract — base types.
 *
 * Zero module dependencies, so `ecommerce`, `cart`, `checkout` and `catalog`
 * can consume this without a `requires` edge on either `availability` or `wms`.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §4.1a
 */

export type AvailabilityState =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'backorder'
  | 'preorder'
  | 'not_tracked'

export type AvailabilityItemQuery = {
  catalogProductId: string
  /** `null` or omitted → product-level rollup over active variants. */
  catalogVariantId?: string | null
  /** The quantity being asked about; state is relative to it. */
  quantity: number
}

export type AvailabilityQuery = {
  tenantId: string
  organizationId: string
  items: AvailabilityItemQuery[]
  /** Selects the policy chain. */
  storeId?: string | null
  channelId?: string | null
  /** `null`/omitted → every in-scope location. */
  locationIds?: string[] | null
  /**
   * Additive, optional. When true, a provider MUST skip any internal read
   * cache and compute a live result — the §6 "cart re-validation" row.
   */
  bypassCache?: boolean
}

export type AvailabilityItemResult = {
  state: AvailabilityState
  /** Sellable quantity; `null` when not tracked. */
  availableQuantity: number | null
  /** Whether the requested quantity can be met, including a backorder/preorder path. */
  canFulfil: boolean
  /** Set for `'backorder'`. */
  leadTimeDays: number | null
  /** ISO-8601; set for `'preorder'`. */
  releaseAt: string | null
  /** `false` for a cached browse-time read — never a guarantee. */
  isAuthoritative: boolean
  /** The `AvailabilityPolicy` row that decided, or `null` for a module default. */
  policySourceId: string | null
}

export type AvailabilityResult = {
  /** Key: `${catalogProductId}:${catalogVariantId ?? ''}` — stable and caller-derivable. */
  byItem: Record<string, AvailabilityItemResult>
}

/** Narrow DI port a provider resolves its per-call dependencies (`em`, cache, services) from. */
export type AvailabilityDependencyResolver = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Per-call context handed to a provider. `container` is the calling
 * request's DI container; a provider MUST resolve its dependencies from it
 * (or build its own when absent) and never from a container captured at
 * registration time — the registry is process-wide.
 */
export type AvailabilityProviderContext = {
  container?: AvailabilityDependencyResolver | null
}

export interface AvailabilityProvider {
  id: string
  getAvailability(query: AvailabilityQuery, context?: AvailabilityProviderContext): Promise<AvailabilityResult>
}

/** Builds the stable `AvailabilityResult.byItem` key for an item. */
export function availabilityItemKey(item: { catalogProductId: string; catalogVariantId?: string | null }): string {
  return `${item.catalogProductId}:${item.catalogVariantId ?? ''}`
}
