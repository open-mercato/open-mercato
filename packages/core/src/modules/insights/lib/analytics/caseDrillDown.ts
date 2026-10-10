import { compareCodeUnits } from '../process/registry'
import type { ProcessMapResult, VariantsResult } from './types'

/**
 * The analytics cells a case listing drills into: an activity (a node of the process map) and
 * stored variant hashes (as the variants report them in `rawVariantHashes`), deduplicated and in
 * code-unit order. `activityKey` is `null` and `variantHashes` empty when the listing does not
 * drill into that dimension.
 */
export type CaseDrillDown = {
  activityKey: string | null
  variantHashes: string[]
}

export function caseDrillDownOf(request: { activityKey?: string; variantHash?: string; variantHashes?: readonly string[] }): CaseDrillDown {
  const variantHashes = [...(request.variantHash ? [request.variantHash] : []), ...(request.variantHashes ?? [])]
  return {
    activityKey: request.activityKey ?? null,
    variantHashes: Array.from(new Set(variantHashes)).sort(compareCodeUnits),
  }
}

export function hasCaseDrillDown(drillDown: CaseDrillDown): boolean {
  return drillDown.activityKey !== null || drillDown.variantHashes.length > 0
}

/**
 * Whether the process map shows the activity's node. A node suppressed by the k / three-actor
 * rule, suppressed as a complementary sibling or omitted beyond the node cap is not among the
 * reported `nodes`, so it is not visible (fail closed).
 */
export function isActivityNodeVisible(map: Pick<ProcessMapResult, 'nodes'>, activityKey: string): boolean {
  return map.nodes.some((node) => node.activityKey === activityKey)
}

/**
 * Whether every requested stored variant hash is listed in the `rawVariantHashes` of a reported
 * variant. Hashes of suppressed (complementary included) variants, of variants beyond the limit
 * and hashes cut from a truncated list are not listed, so they are not visible (fail closed); an
 * empty request is never visible.
 */
export function areVariantHashesVisible(variants: Pick<VariantsResult, 'items'>, variantHashes: readonly string[]): boolean {
  if (variantHashes.length === 0) return false
  const listed = new Set<string>()
  for (const item of variants.items) for (const hash of item.rawVariantHashes) listed.add(hash)
  return variantHashes.every((hash) => listed.has(hash))
}
