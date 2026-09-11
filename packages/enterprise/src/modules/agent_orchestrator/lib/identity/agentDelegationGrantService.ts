import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { AgentDelegationGrant, AgentPrincipal } from '../../data/entities'
import {
  createAgentDelegationGrantSchema,
  type CreateAgentDelegationGrantInput,
} from '../../data/validators'

export type GrantScope = { tenantId: string; organizationId: string }

function resolveEm(container: AwilixContainer): EntityManager {
  return (container.resolve('em') as EntityManager).fork()
}

/**
 * Create an `AgentDelegationGrant` for an external (`oauth_client`) agent
 * principal. Org-scoped: the grant is pinned to the request's tenant + org and
 * the referenced `AgentPrincipal` MUST live in the same org (a grant can never
 * cross tenants). Returns the persisted grant. Tenant/org come from `scope`,
 * never from caller input.
 */
export async function createAgentDelegationGrant(
  container: AwilixContainer,
  scope: GrantScope,
  input: CreateAgentDelegationGrantInput,
): Promise<AgentDelegationGrant> {
  const parsed = createAgentDelegationGrantSchema.parse(input)
  const em = resolveEm(container)
  const { tenantId, organizationId } = scope

  const principal = await em.findOne(AgentPrincipal, {
    id: parsed.agentPrincipalId,
    organizationId,
    deletedAt: null,
  })
  if (!principal) {
    throw new Error('[internal] agent principal not found for delegation grant (or cross-tenant)')
  }

  const grant = em.create(AgentDelegationGrant, {
    tenantId,
    organizationId,
    agentPrincipalId: principal.id,
    agentUserId: principal.userId,
    delegatorUserId: parsed.delegatorUserId,
    scopes: parsed.scopes,
    expiresAt: parsed.expiresAt ?? null,
    revokedAt: null,
    revokedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(grant)
  await em.flush()
  return grant
}

/**
 * Resolve a LIVE, org-scoped delegation grant by id. Returns null when the grant
 * does not exist or belongs to another org. Does NOT filter by `revokedAt` — the
 * caller decides (the token mint refuses a revoked grant; verification denies it).
 */
export async function resolveAgentDelegationGrant(
  container: AwilixContainer,
  scope: GrantScope,
  grantId: string,
): Promise<AgentDelegationGrant | null> {
  const em = resolveEm(container)
  return em.findOne(AgentDelegationGrant, {
    id: grantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

/**
 * A grant is ACTIVE when it is not revoked and not past its hard expiry. The
 * `/token` server refuses to mint, and verification denies, when this is false —
 * so revoking stops further action on the NEXT request, not at token TTL.
 */
export function isGrantActive(grant: AgentDelegationGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt != null) return false
  if (grant.expiresAt != null && grant.expiresAt.getTime() <= now.getTime()) return false
  return true
}
