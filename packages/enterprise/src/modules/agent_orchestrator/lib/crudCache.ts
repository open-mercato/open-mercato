import { canonicalizeResourceTag, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { AgentProposal, AgentRun } from '../data/entities'

/**
 * CRUD GET-cache invalidation for runs and proposals written outside a route.
 *
 * `/api/agent_orchestrator/runs` and `/api/agent_orchestrator/proposals` are
 * `makeCrudRoute` lists, so under `ENABLE_CRUD_API_CACHE=true` (the integration
 * and snapshot environments, and any deployment that opts in) their responses
 * are cached behind tags the factory flushes on ITS OWN writes. Every write in
 * this module is a Command or an ingestion service instead, so nothing flushed
 * those tags: a disposed proposal kept reading back `pending` and never left the
 * operator's caseload, and a finished run kept reading `running`, until the
 * entry expired on TTL. The same explicit-invalidation precedent as the
 * warranty_claims commands.
 *
 * The tags are derived from the ORM class names rather than written out: neither
 * route configures `events`/`actions`, so `resolveResourceAliasesList` falls back
 * to the entity name, and reading it from the class keeps write and read in step
 * through a rename.
 */
const AGENT_RUN_RESOURCE = canonicalizeResourceTag(AgentRun.name) ?? 'agent.run'
const AGENT_PROPOSAL_RESOURCE = canonicalizeResourceTag(AgentProposal.name) ?? 'agent.proposal'

type CacheContainer = Parameters<typeof invalidateCrudCache>[0]

export type AgentOrchestratorCacheTarget = {
  id: string
  tenantId: string | null
  organizationId: string | null
}

async function invalidate(
  container: CacheContainer,
  resource: string,
  target: AgentOrchestratorCacheTarget,
  reason: string,
): Promise<void> {
  await invalidateCrudCache(
    container,
    resource,
    { id: target.id, organizationId: target.organizationId, tenantId: target.tenantId },
    target.tenantId,
    reason,
  )
}

export function invalidateAgentRunCache(
  container: CacheContainer,
  target: AgentOrchestratorCacheTarget,
  reason: string,
): Promise<void> {
  return invalidate(container, AGENT_RUN_RESOURCE, target, reason)
}

export function invalidateAgentProposalCache(
  container: CacheContainer,
  target: AgentOrchestratorCacheTarget,
  reason: string,
): Promise<void> {
  return invalidate(container, AGENT_PROPOSAL_RESOURCE, target, reason)
}
