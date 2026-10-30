import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getToolRegistry } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { resolveManifestToolNames } from '../trace/runManifestEntry'
import type { EffectiveToolAcl } from './resolveEffectiveToolAcl'
import type { FeatureGrantSet } from './toolAclGrantIntersection'

export type ToolRequiredFeaturesResolver = (toolName: string) => readonly string[] | null

export type PrincipalToolAclRecord = {
  mode: 'intersect'
  deniedByPrincipal: string[]
}

function isGranted(requiredFeatures: readonly string[], acl: FeatureGrantSet): boolean {
  return authorizeFeatures([...requiredFeatures], {
    grantedFeatures: acl.features,
    unrestricted: acl.isSuperAdmin,
  })
}

/**
 * Tools the caller's own ACL authorizes but the intersected (principal ∩
 * caller) ACL does not — the tools the agent principal took away. Unknown tools
 * (no registry entry) are never reported. The result is sorted and unique.
 */
export function computePrincipalDeniedTools(
  toolNames: readonly string[],
  callerAcl: FeatureGrantSet,
  effectiveAcl: FeatureGrantSet,
  resolveRequiredFeatures: ToolRequiredFeaturesResolver,
): string[] {
  const denied = new Set<string>()
  for (const toolName of toolNames) {
    const requiredFeatures = resolveRequiredFeatures(toolName)
    if (!requiredFeatures || requiredFeatures.length === 0) continue
    if (isGranted(requiredFeatures, callerAcl) && !isGranted(requiredFeatures, effectiveAcl)) denied.add(toolName)
  }
  return Array.from(denied).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export function resolveRegistryToolRequiredFeatures(toolName: string): readonly string[] | null {
  try {
    const tool = getToolRegistry().getTool(toolName) as { requiredFeatures?: string[] } | undefined
    return tool ? (tool.requiredFeatures ?? []) : null
  } catch {
    return null
  }
}

/**
 * The manifest record of an `intersect`-mode run: which of the agent's
 * allowlisted tools the principal denied. `null` in `caller` mode.
 */
export function resolvePrincipalToolAclRecord(
  entry: AgentRegistryEntry,
  acl: EffectiveToolAcl,
  resolveRequiredFeatures: ToolRequiredFeaturesResolver = resolveRegistryToolRequiredFeatures,
): PrincipalToolAclRecord | null {
  if (acl.mode !== 'intersect') return null
  if (!acl.callerAcl) return { mode: 'intersect', deniedByPrincipal: [] }
  return {
    mode: 'intersect',
    deniedByPrincipal: computePrincipalDeniedTools(
      resolveManifestToolNames(entry),
      acl.callerAcl,
      { features: acl.features, isSuperAdmin: acl.isSuperAdmin },
      resolveRequiredFeatures,
    ),
  }
}
