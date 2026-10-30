import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentPrincipal } from '../../data/entities'
import { getAgentEntry, type AgentRegistryEntry } from '../sdk/defineAgent'
import type { AgentInvoker, AgentRunAs, AgentRunCtx } from '../runtime/persistence'
import { AgentPrincipalMissingError } from '../runtime/errors'
import { resolveInvoker } from '../access/agentInvokeAccess'
import { getAgentActorScope } from './agentWriteScope'

const logger = createLogger('agent_orchestrator').child({ component: 'resolve-run-as' })

export type ResolveRunAsForAgentInput = {
  agentId: string
  /** The registry entry when the caller already holds it; looked up by id otherwise. */
  entry?: Pick<AgentRegistryEntry, 'id' | 'principal'> | null
  ctx: Pick<AgentRunCtx, 'tenantId' | 'organizationId' | 'userId' | 'invoker'>
}

export type ResolveRunAsForAgentOptions = {
  /** EntityManager for the principal lookup; a fork of the container `em` by default. */
  em?: EntityManager
}

/**
 * The human an agent run acts on behalf of, read from its invoker. An API key
 * acts for its owning user, a workflow for its acting user, an agent token for
 * the human it was delegated by.
 */
export function onBehalfOfUserIdForInvoker(invoker: AgentInvoker | null): string | null {
  if (!invoker) return null
  switch (invoker.kind) {
    case 'user':
      return invoker.userId || null
    case 'api_key':
      return invoker.ownerUserId ?? null
    case 'workflow':
      return invoker.actingUserId || null
    case 'agent_token':
      return invoker.onBehalfOfUserId ?? null
  }
}

async function findEnabledPrincipal(
  container: AwilixContainer,
  agentId: string,
  ctx: ResolveRunAsForAgentInput['ctx'],
  em: EntityManager | undefined,
): Promise<AgentPrincipal | null> {
  const lookupEm = em ?? (container.resolve('em') as EntityManager).fork()
  const principal = await findOneWithDecryption(
    lookupEm,
    AgentPrincipal,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentDefinitionId: agentId,
      enabled: true,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  return principal && principal.enabled ? principal : null
}

/**
 * The single resolver of the `runAs` binding (identity spec Phase 2): the
 * agent's enabled principal in the run's organization acts, on behalf of the
 * invoker's human. Inside a principal-bound parent run (`delegate_agent`) the
 * child acts for the parent's human, never for the parent agent.
 *
 * Returns null when the agent has no enabled principal, so the run keeps the
 * caller's attribution. An agent declaring `principal.required: true` refuses
 * instead with {@link AgentPrincipalMissingError}. A failed lookup is reported
 * and treated as no principal.
 */
export async function resolveRunAsForAgent(
  container: AwilixContainer,
  input: ResolveRunAsForAgentInput,
  options: ResolveRunAsForAgentOptions = {},
): Promise<AgentRunAs | null> {
  const { agentId, ctx } = input
  const entry = input.entry === undefined ? getAgentEntry(agentId) : input.entry
  let principal: AgentPrincipal | null = null
  try {
    principal = await findEnabledPrincipal(container, agentId, ctx, options.em)
  } catch (error) {
    logger.warn('agent principal lookup failed; running without a principal', {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.principal_lookup_failed',
      attributes: { agentId },
    })
  }
  if (!principal) {
    if (entry?.principal?.required === true) throw new AgentPrincipalMissingError(agentId)
    return null
  }
  const parentScope = getAgentActorScope()
  const onBehalfOfUserId = parentScope
    ? (parentScope.onBehalfOfUserId ?? null)
    : onBehalfOfUserIdForInvoker(resolveInvoker(ctx))
  return { agentUserId: principal.userId, onBehalfOfUserId }
}
