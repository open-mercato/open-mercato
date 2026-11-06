import { intersectFeatureGrants, type FeatureGrantSet } from '@open-mercato/shared/security/features'

export type { FeatureGrantSet }

/**
 * Pure grant computation for the `intersect` tool ACL mode: keeps only what both
 * the agent principal and the caller hold, over grant sets that were already
 * resolved by the realm service. It never loads ACLs and never decides about a
 * live subject — tool calls are still authorized through `authorizeFeatures`
 * against the returned set.
 */
export function intersectToolAclGrants(principalAcl: FeatureGrantSet, callerAcl: FeatureGrantSet): FeatureGrantSet {
  return intersectFeatureGrants(principalAcl, callerAcl)
}
