import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentPrincipal } from '../../data/entities'
import { agentPrincipalToolAclModeSchema } from '../../data/validators'
import type { AgentRegistryEntry } from '../sdk/defineAgent'

const logger = createLogger('agent_orchestrator').child({ component: 'principal-summary' })

/**
 * Read-only view of an agent's principal for the agents API: whether the agent
 * declares one, whether a live principal exists in the organization and is
 * enabled, the declared tool ACL mode and fail-closed flag, and the declared
 * role features. Null when the agent neither declares nor has a principal.
 */
export const agentPrincipalSummarySchema = z
  .object({
    declared: z.boolean(),
    provisioned: z.boolean(),
    enabled: z.boolean(),
    toolAcl: agentPrincipalToolAclModeSchema,
    required: z.boolean(),
    roleFeatures: z.array(z.string()).optional(),
  })
  .nullable()

export type AgentPrincipalSummary = z.infer<typeof agentPrincipalSummarySchema>

export type AgentPrincipalSummaryScope = {
  tenantId: string | null
  organizationId: string | null
}

export type AgentPrincipalState = Pick<AgentPrincipal, 'agentDefinitionId' | 'enabled'>

/**
 * Loads the live principals of the given agents in one tenant- and
 * organization-scoped query, keyed by agent id. Without a full scope nothing is
 * provisioned. A failed lookup is reported and read as no principals, so the
 * agents listing never fails on it.
 */
export async function loadAgentPrincipalStates(
  em: EntityManager,
  scope: AgentPrincipalSummaryScope,
  agentIds: readonly string[],
): Promise<Map<string, AgentPrincipalState>> {
  const states = new Map<string, AgentPrincipalState>()
  const { tenantId, organizationId } = scope
  if (!tenantId || !organizationId || agentIds.length === 0) return states
  try {
    const rows = await findWithDecryption(
      em,
      AgentPrincipal,
      { tenantId, organizationId, agentDefinitionId: { $in: [...agentIds] }, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    for (const row of rows) {
      if (row.tenantId !== tenantId || row.organizationId !== organizationId) continue
      states.set(row.agentDefinitionId, { agentDefinitionId: row.agentDefinitionId, enabled: row.enabled })
    }
  } catch (error) {
    logger.warn('agent principal summary lookup failed; listing agents without principals', {
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.principal_summary_lookup_failed',
    })
    states.clear()
  }
  return states
}

export function summarizeAgentPrincipal(
  entry: Pick<AgentRegistryEntry, 'principal'>,
  state: AgentPrincipalState | null | undefined,
): AgentPrincipalSummary {
  const declaration = entry.principal
  if (!declaration && !state) return null
  return {
    declared: Boolean(declaration),
    provisioned: Boolean(state),
    enabled: state?.enabled === true,
    toolAcl: declaration?.toolAcl ?? 'caller',
    required: declaration?.required === true,
    ...(declaration ? { roleFeatures: [...declaration.roleFeatures] } : {}),
  }
}
