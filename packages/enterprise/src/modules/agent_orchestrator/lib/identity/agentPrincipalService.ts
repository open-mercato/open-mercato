import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  executionPrincipalRoleName,
  provisionExecutionPrincipal,
} from '@open-mercato/core/modules/auth/lib/executionPrincipal'
import { Role, User } from '@open-mercato/core/modules/auth/data/entities'
import {
  provisionAgentPrincipalSchema,
  type ProvisionAgentPrincipalInput,
} from '../../data/validators'
import { AgentPrincipal } from '../../data/entities'

export type AgentPrincipalScope = { tenantId: string; organizationId: string }

/**
 * The resolved identity of a provisioned agent — the concrete `auth.User` id used
 * as the actor on every write the agent makes, plus the scoped role and the
 * principal row. Phase 2 (`runAs` / on-behalf-of) reads `userId` as the
 * `actorUserId` it stamps on each `ActionLog`.
 */
export type ResolvedAgentPrincipal = {
  principal: AgentPrincipal
  userId: string
  roleId: string
  /** True iff the agent `User` holds NO interactive credential (passwordHash null + not confirmed). */
  interactiveLoginDisabled: boolean
}

const AGENT_PRINCIPAL_NAME_PREFIX = 'agent'

function resolveEm(container: AwilixContainer): EntityManager {
  return (container.resolve('em') as EntityManager).fork()
}

/**
 * Provisions — idempotently — an `AgentPrincipal`: a non-interactive `auth.User`
 * (`kind='agent'`) and a scoped, least-privilege `auth.Role`, so the agent is a
 * first-class principal attributed identically to a human on every write.
 *
 * The User / Role / RoleAcl / UserRole find-or-create steps delegate to core's
 * `provisionExecutionPrincipal` keyed by the bare agent definition id with the
 * `agent` name prefix and `mergeFeatures: true`, which reproduces the historical
 * email (`agent+<slug>+<orgId>@agent.internal`) and role name
 * (`agent:<agentDefinitionId>`) byte-for-byte, so already provisioned rows keep
 * their identity. Re-provisioning only ever widens the role ACL here; the
 * declarative path (`syncAgentPrincipals`) is the one that narrows. A live
 * principal whose role is not the historical `agent:<agentDefinitionId>` role
 * (a declaratively provisioned one) is returned untouched, so this path can
 * never widen a declared ACL.
 *
 * Non-interactive enforcement: the agent `User` has `passwordHash = null` and
 * `isConfirmed = false`, so the interactive login flow has no credential to
 * verify against. Idempotency: keyed on `(organizationId, agentDefinitionId)`
 * over live `AgentPrincipal` rows; every lookup and write pins both `tenantId`
 * and `organizationId`.
 */
export async function provisionAgentPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  input: ProvisionAgentPrincipalInput,
): Promise<ResolvedAgentPrincipal> {
  const parsed = provisionAgentPrincipalSchema.parse(input)
  const { tenantId, organizationId } = scope
  const em = resolveEm(container)
  const legacyRoleName = executionPrincipalRoleName(parsed.agentDefinitionId, AGENT_PRINCIPAL_NAME_PREFIX)

  const existing = await findOneWithDecryption(
    em,
    AgentPrincipal,
    { tenantId, organizationId, agentDefinitionId: parsed.agentDefinitionId, deletedAt: null },
    {},
    { tenantId, organizationId },
  )
  const existingRole = existing
    ? await findOneWithDecryption(em, Role, { id: existing.roleId, tenantId }, {}, { tenantId, organizationId: null })
    : null
  const ownedElsewhere = Boolean(existing && existingRole?.name !== legacyRoleName)

  const provisioned = ownedElsewhere
    ? null
    : await provisionExecutionPrincipal(container, scope, {
        principalKey: parsed.agentDefinitionId,
        displayName: parsed.displayName ?? parsed.agentDefinitionId,
        features: parsed.roleFeatures,
        kind: 'agent',
        namePrefix: AGENT_PRINCIPAL_NAME_PREFIX,
        mergeFeatures: true,
      })

  const userId = existing?.userId ?? provisioned?.userId
  const user = userId
    ? await findOneWithDecryption(em, User, { id: userId, tenantId }, {}, { tenantId, organizationId })
    : null
  if (!user || user.kind !== 'agent') {
    throw new Error('[internal] resolved a non-agent User for an agent principal')
  }

  let principal = existing
  if (!principal && provisioned) {
    principal = em.create(AgentPrincipal, {
      tenantId,
      organizationId,
      userId: provisioned.userId,
      agentDefinitionId: parsed.agentDefinitionId,
      roleId: provisioned.roleId,
      credentialMode: parsed.credentialMode,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(principal)
    await em.flush()
  }
  if (!principal) {
    throw new Error('[internal] agent principal could not be provisioned')
  }

  return {
    principal,
    userId: principal.userId,
    roleId: principal.roleId,
    interactiveLoginDisabled: !user.passwordHash && user.isConfirmed === false,
  }
}

/**
 * Resolves the agent principal for `(organizationId, agentDefinitionId)` without
 * provisioning. Returns null when the agent has not been provisioned yet (or was
 * soft-deleted or disabled). Tenant- and org-scoped — never returns another tenant's row.
 */
export async function resolveAgentPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  agentDefinitionId: string,
): Promise<AgentPrincipal | null> {
  const em = resolveEm(container)
  return em.findOne(AgentPrincipal, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    agentDefinitionId,
    enabled: true,
    deletedAt: null,
  })
}
