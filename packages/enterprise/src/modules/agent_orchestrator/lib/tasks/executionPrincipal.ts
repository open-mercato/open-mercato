import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  provisionAgentPrincipal,
  type AgentPrincipalScope,
  type ResolvedAgentPrincipal,
} from '../identity/agentPrincipalService'

/**
 * Synthetic agent-definition id for a task's execution principal. Namespaced so
 * it can never collide with a real registry agent id, and stable per task so
 * `provisionAgentPrincipal`'s `(organizationId, agentDefinitionId)` idempotency
 * key holds across re-provisioning.
 */
export function taskExecutionAgentId(taskDefinitionId: string): string {
  return `task:${taskDefinitionId}`
}

/**
 * Provisions (idempotently) the dedicated execution principal for an
 * `AgentTaskDefinition` and pins its scoped role's ACL to EXACTLY
 * `grantedFeatures`. `provisionAgentPrincipal` only ever merges features, which
 * cannot narrow a previously over-granted task — so after provisioning, the
 * role ACL is replaced with the requested set (least-privilege re-scoping on
 * every create/update, self-healing per the spec's stray-grant risk entry).
 */
export async function provisionTaskExecutionPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  input: { taskDefinitionId: string; displayName: string; grantedFeatures: string[] },
): Promise<ResolvedAgentPrincipal> {
  const resolved = await provisionAgentPrincipal(container, scope, {
    agentDefinitionId: taskExecutionAgentId(input.taskDefinitionId),
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
