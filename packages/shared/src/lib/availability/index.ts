/**
 * Public entrypoint for the Availability Contract's shared, dependency-free
 * base — types, the provider registry, `resolveAvailability()`, and the
 * built-in `catalog-only` fallback.
 *
 * Importing from this barrel (rather than `./registry` directly) guarantees
 * the `catalog-only` provider is registered — it self-registers as an import
 * side effect in `./catalogOnlyProvider`, which this file always pulls in.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §4.1a
 */

export * from './types'
export * from './registry'
export { setCatalogOnlyPolicyLookup } from './catalogOnlyProvider'
export type { CatalogOnlyPolicyLookup, CatalogOnlyPolicyOverride } from './catalogOnlyProvider'

import './catalogOnlyProvider'
