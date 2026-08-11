/**
 * Workflows Module - server-side output-contract resolver.
 *
 * NOT pure: this is the concrete implementation server callers (the
 * context-schema API route) inject into `computeContextLedger`'s
 * `resolveOutputContract` seam. It is only meaningful in the server runtime,
 * where the activity registry is bootstrapped (guaranteed by the bootstrap
 * import below) and the command registry holds the loaded command handlers —
 * `commandRegistry.outputSchemaOf` is sync over already-registered handlers,
 * so UPDATE_ENTITY's outputContract resolves a real Zod schema there and
 * degrades honestly to 'unknown' elsewhere. The browser-side ledger never
 * resolves contracts locally; it consumes the resolved entries from the
 * context-schema API response.
 *
 * A registry entry's `outputContract` yields `ZodTypeAny | 'unknown'`
 * (activity-registry.ts); the instanceof guard also keeps third-party entries
 * honest at runtime before flattening.
 */

import { ZodType } from 'zod'
import './activity-registry-bootstrap'
import { getActivityType } from './activity-registry'
import {
  bindAgentOutcomeSchemaResolver,
  bindCallApiResponseSchemaResolver,
  type AgentOutcomeContract,
} from './activity-types'
import { findEndpointResponseSchema } from './endpoint-catalog'
import { flattenSchemaToContract } from './ledger-schema-flatten'
import type { ResolveOutputContract } from './context-ledger'

/**
 * CALL_API's registry outputContract reaches the server-only endpoint
 * catalog through this binding (mirroring bindActivityExecutor). The sync
 * lookup reads the per-process catalog cache, so callers that want CALL_API
 * contracts resolved must `await ensureWorkflowEndpointCatalog()` first —
 * the context-schema route does; unwarmed processes degrade to 'unknown'.
 */
bindCallApiResponseSchemaResolver((endpoint, method) => findEndpointResponseSchema(endpoint, method) ?? 'unknown')

/**
 * INVOKE_AGENT's registry outputContract reaches the OPTIONAL agent_orchestrator
 * peer the same way the executor does: through DI, never an import. The peer's
 * `agentWorkflowBridge` service may expose `listAgentOutcomeContracts()` (an
 * additive, optional method — an older peer without it is simply a peer without
 * agent typing); this module caches the returned OUTCOME schemas per process and
 * the bound resolver reads that cache synchronously. Callers that want agent
 * contracts resolved must `await ensureWorkflowAgentOutcomeContracts(container)`
 * first — the context-schema route does; unwarmed processes, an absent peer, and
 * a failing lookup all degrade to 'unknown' without throwing.
 */
type AgentOutcomeContractSnapshot = {
  agentId?: unknown
  resultKind?: unknown
  schema?: unknown
}

type AgentOutcomeBridgeLike = {
  listAgentOutcomeContracts?: () => Promise<AgentOutcomeContractSnapshot[]>
}

type ServiceContainer = {
  resolve: <T>(name: string) => T
}

let agentOutcomeContracts: Map<string, AgentOutcomeContract> | null = null
let agentOutcomeWarmup: Promise<void> | null = null

bindAgentOutcomeSchemaResolver((agentId) => agentOutcomeContracts?.get(agentId) ?? 'unknown')

function toAgentOutcomeContract(snapshot: AgentOutcomeContractSnapshot): AgentOutcomeContract | null {
  const { agentId, resultKind, schema } = snapshot
  if (typeof agentId !== 'string' || agentId.length === 0) return null
  if (resultKind !== 'researcher' && resultKind !== 'proposal') return null
  if (!(schema instanceof ZodType)) return null
  return { resultKind, schema }
}

async function loadAgentOutcomeContracts(container: ServiceContainer): Promise<void> {
  let bridge: AgentOutcomeBridgeLike | undefined
  try {
    bridge = container.resolve<AgentOutcomeBridgeLike>('agentWorkflowBridge')
  } catch {
    bridge = undefined
  }
  if (!bridge || typeof bridge.listAgentOutcomeContracts !== 'function') {
    agentOutcomeContracts = new Map()
    return
  }
  const resolved = new Map<string, AgentOutcomeContract>()
  try {
    for (const snapshot of await bridge.listAgentOutcomeContracts()) {
      const contract = toAgentOutcomeContract(snapshot)
      if (contract && typeof snapshot.agentId === 'string') resolved.set(snapshot.agentId, contract)
    }
  } catch {
    agentOutcomeContracts = new Map()
    return
  }
  agentOutcomeContracts = resolved
}

export async function ensureWorkflowAgentOutcomeContracts(container: ServiceContainer): Promise<void> {
  if (!agentOutcomeWarmup) agentOutcomeWarmup = loadAgentOutcomeContracts(container)
  await agentOutcomeWarmup
}

export function clearWorkflowAgentOutcomeContractsForTests(): void {
  agentOutcomeContracts = null
  agentOutcomeWarmup = null
}

export const resolveServerOutputContract: ResolveOutputContract = (activityType, config) => {
  const entry = getActivityType(activityType)
  const contract = entry?.outputContract
  if (typeof contract !== 'function') return 'unknown'
  const resolved = contract(config)
  if (!(resolved instanceof ZodType)) return 'unknown'
  return flattenSchemaToContract(resolved)
}
