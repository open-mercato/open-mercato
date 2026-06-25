import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
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

/**
 * Deterministic, internal-only email for an agent `User`. Not a deliverable
 * mailbox — agents never receive mail and never log in interactively. Keyed by
 * the agent definition id + organization so it is stable across re-provisioning
 * (idempotency) and unique per org. The `.agent.internal` TLD is reserved/non-
 * routable so it can never collide with a real human's address.
 */
function buildAgentUserEmail(agentDefinitionId: string, organizationId: string): string {
  const slug = agentDefinitionId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return `agent+${slug}+${organizationId}@agent.internal`
}

/** Deterministic, tenant-scoped role name for an agent's least-privilege role. */
function buildAgentRoleName(agentDefinitionId: string): string {
  return `agent:${agentDefinitionId}`
}

function resolveEm(container: AwilixContainer): EntityManager {
  return (container.resolve('em') as EntityManager).fork()
}

/**
 * Provisions — idempotently — an `AgentPrincipal`: a non-interactive `auth.User`
 * (`kind='agent'`) and a scoped, least-privilege `auth.Role`, so the agent is a
 * first-class principal attributed identically to a human on every write (agent
 * identity & on-behalf-of spec, Wave 4 Phase 1).
 *
 * Internal-agent attribution: the returned `userId` is the concrete actor id the
 * Phase-2 `runAs` wrapper stamps on each `ActionLog`.
 *
 * Non-interactive enforcement: the agent `User` is created with
 * `passwordHash = null` and `isConfirmed = false`, so the interactive
 * password/SSO login flow has no credential to verify against — it is a property
 * of the principal, not a special-case block. External token flows are Phase 3
 * (`credentialMode='oauth_client'`) and are NOT provisioned here.
 *
 * Idempotency: keyed on `(organizationId, agentDefinitionId)` over live rows
 * (partial unique index). A second call resolves and returns the same principal,
 * creating no duplicate `User`/`Role`/`AgentPrincipal` rows. Tenant-scoped: every
 * lookup and write pins both `tenantId` and `organizationId`.
 */
export async function provisionAgentPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  input: ProvisionAgentPrincipalInput,
): Promise<ResolvedAgentPrincipal> {
  const parsed = provisionAgentPrincipalSchema.parse(input)
  const em = resolveEm(container)
  const { tenantId, organizationId } = scope

  const auth = (await import(
    '@open-mercato/core/modules/auth/data/entities'
  )) as typeof import('@open-mercato/core/modules/auth/data/entities')

  return em.transactional(async (tem) => {
    const existingPrincipal = await tem.findOne(AgentPrincipal, {
      organizationId,
      agentDefinitionId: parsed.agentDefinitionId,
      deletedAt: null,
    })

    // ── Scoped, least-privilege role (find-or-create, idempotent) ─────────────
    const roleName = buildAgentRoleName(parsed.agentDefinitionId)
    let role = await findOneWithDecryption(
      tem,
      auth.Role,
      { name: roleName, tenantId },
      {},
      { tenantId, organizationId: null },
    )
    if (!role) {
      role = tem.create(auth.Role, { name: roleName, tenantId, createdAt: new Date() })
      tem.persist(role)
      await tem.flush()
    }

    // The scoped role's ACL grants the agent's least-privilege features (merged
    // idempotently on re-provision), never super-admin.
    const existingAcl = await findOneWithDecryption(
      tem,
      auth.RoleAcl,
      { role, tenantId },
      {},
      { tenantId, organizationId: null },
    )
    if (!existingAcl) {
      tem.persist(
        tem.create(auth.RoleAcl, {
          role,
          tenantId,
          featuresJson: parsed.roleFeatures,
          isSuperAdmin: false,
          organizationsJson: [organizationId],
          createdAt: new Date(),
        }),
      )
      await tem.flush()
    } else {
      const current = Array.isArray(existingAcl.featuresJson) ? existingAcl.featuresJson : []
      const merged = Array.from(new Set([...current, ...parsed.roleFeatures]))
      if (merged.length !== current.length) {
        existingAcl.featuresJson = merged
        tem.persist(existingAcl)
        await tem.flush()
      }
    }

    // ── Non-interactive agent User (find-or-create, idempotent) ───────────────
    const agentEmail = buildAgentUserEmail(parsed.agentDefinitionId, organizationId)
    let user = existingPrincipal
      ? await findOneWithDecryption(
          tem,
          auth.User,
          { id: existingPrincipal.userId },
          {},
          { tenantId, organizationId },
        )
      : await findOneWithDecryption(
          tem,
          auth.User,
          { emailHash: computeEmailHash(agentEmail), tenantId, deletedAt: null },
          {},
          { tenantId, organizationId },
        )

    if (!user) {
      user = tem.create(auth.User, {
        email: agentEmail,
        emailHash: computeEmailHash(agentEmail),
        // No interactive credential: a null passwordHash + unconfirmed account
        // means the password/SSO login flow has nothing to authenticate against.
        passwordHash: null,
        isConfirmed: false,
        kind: 'agent',
        name: parsed.displayName ?? parsed.agentDefinitionId,
        tenantId,
        organizationId,
        createdAt: new Date(),
      })
      tem.persist(user)
      await tem.flush()
    } else if (user.kind !== 'agent') {
      // Defensive: an existing row resolved by the deterministic agent email must
      // be an agent principal. Never silently repurpose a human/service row.
      throw new Error('[internal] resolved a non-agent User for an agent principal')
    }

    // Link the agent User to its scoped role (idempotent).
    const existingLink = await findOneWithDecryption(
      tem,
      auth.UserRole,
      { user, role },
      {},
      { tenantId, organizationId: null },
    )
    if (!existingLink) {
      tem.persist(tem.create(auth.UserRole, { user, role, createdAt: new Date() }))
      await tem.flush()
    }

    // ── AgentPrincipal row (find-or-create, idempotent) ───────────────────────
    let principal = existingPrincipal
    if (!principal) {
      principal = tem.create(AgentPrincipal, {
        tenantId,
        organizationId,
        userId: user.id,
        agentDefinitionId: parsed.agentDefinitionId,
        roleId: role.id,
        credentialMode: parsed.credentialMode,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      tem.persist(principal)
      await tem.flush()
    }

    return {
      principal,
      userId: principal.userId,
      roleId: principal.roleId,
      interactiveLoginDisabled: !user.passwordHash && user.isConfirmed === false,
    }
  })
}

/**
 * Resolves the agent principal for `(organizationId, agentDefinitionId)` without
 * provisioning. Returns null when the agent has not been provisioned yet (or was
 * soft-deleted). Org-scoped — never returns another tenant's row.
 */
export async function resolveAgentPrincipal(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  agentDefinitionId: string,
): Promise<AgentPrincipal | null> {
  const em = resolveEm(container)
  return em.findOne(AgentPrincipal, {
    organizationId: scope.organizationId,
    agentDefinitionId,
    deletedAt: null,
  })
}
