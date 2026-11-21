import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { loadInvokerAcl } from '../access/agentInvokeAccess'
import { invokerFromAuth } from '../access/invokeDenial'

export const EVAL_SET_IMPORT_FEATURES = ['agent_orchestrator.eval.manage'] as const
export const EVAL_SET_EXPORT_FEATURES = ['agent_orchestrator.eval.export'] as const

/**
 * Whether the caller holds every listed eval feature in the given scope. The
 * eval-set routes re-check this in the handler so the rule holds even when the
 * metadata guard is bypassed; any ACL failure fails closed.
 */
export async function hasEvalSetFeatures(
  container: AwilixContainer,
  auth: AuthContext,
  scope: { tenantId: string | null; organizationId: string | null },
  features: readonly string[],
): Promise<boolean> {
  if (!auth) return false
  try {
    const acl = await loadInvokerAcl(container, invokerFromAuth(auth), scope)
    return authorizeFeatures(features, { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin })
  } catch {
    return false
  }
}
