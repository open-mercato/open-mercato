import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  provisionAgentPrincipal,
  type AgentPrincipalScope,
  type ResolvedAgentPrincipal,
} from '../identity/agentPrincipalService'

/**
 * Synthetic agent-definition id for a process definition's execution principal.
 * Namespaced so it can never collide with a real registry agent id, and stable
 * per definition so `provisionAgentPrincipal`'s `(organizationId,
 * agentDefinitionId)` idempotency key holds across re-provisioning. The `task:`
 * prefix is a PERSISTED key on `agent_principals` and is deliberately left
 * unchanged by the process rename — moving it would orphan every provisioned
 * principal and silently mint a second one per definition.
 */
export function processExecutionAgentId(processDefinitionId: string): string {
  return `task:${processDefinitionId}`
}

/**
 * Provisions (idempotently) the dedicated execution principal for an
 * `AgentProcessDefinition` and pins its scoped role's ACL to EXACTLY
 * `grantedFeatures`. `provisionAgentPrincipal` only ever merges features, which
 * cannot narrow a previously over-granted definition — so after provisioning, the
 * role ACL is replaced with the requested set (least-privilege re-scoping on
 * every create/update, self-healing per the spec's stray-grant risk entry).
 */
export async function provisionProcessExecutionPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  input: { processDefinitionId: string; displayName: string; grantedFeatures: string[] },
): Promise<ResolvedAgentPrincipal> {
  const resolved = await provisionAgentPrincipal(container, scope, {
    agentDefinitionId: processExecutionAgentId(input.processDefinitionId),
    displayName: input.displayName,
    credentialMode: 'internal',
    roleFeatures: input.grantedFeatures,
  })

  const em = (container.resolve('em') as EntityManager).fork()
  const auth = (await import(
    '@open-mercato/core/modules/auth/data/entities'
  )) as typeof import('@open-mercato/core/modules/auth/data/entities')
  const acl = await findOneWithDecryption(
    em,
    auth.RoleAcl,
    { role: resolved.roleId, tenantId: scope.tenantId },
    {},
    { tenantId: scope.tenantId, organizationId: null },
  )
  if (acl) {
    const current = Array.isArray(acl.featuresJson) ? [...acl.featuresJson].sort((a, b) => a.localeCompare(b)) : []
    const requested = [...new Set(input.grantedFeatures)].sort((a, b) => a.localeCompare(b))
    if (JSON.stringify(current) !== JSON.stringify(requested)) {
      acl.featuresJson = requested
      em.persist(acl)
      await em.flush()
    }
  }

  return resolved
}
