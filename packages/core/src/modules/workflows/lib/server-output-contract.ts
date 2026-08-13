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
  /**
   * The agent ANSWERS OUT OF BAND: the bridge returns a suspended marker and the
   * step parks until something outside this process settles it. Additive and
   * OPTIONAL, exactly as `listAgentOutcomeContracts` itself is — a bridge
   * predating the field reports nothing here and the author-time check that
   * reads it stays silent.
   *
   * It names the PROPERTY rather than the runtime that has it, so a second
   * runtime that also parks needs no second special case in this module — and so
   * core never has to carry a list of the peer's runtime names.
   */
  suspends?: unknown
}

type AgentOutcomeBridgeLike = {
  listAgentOutcomeContracts?: () => Promise<AgentOutcomeContractSnapshot[]>
}

type ServiceContainer = {
  resolve: <T>(name: string) => T
}

let agentOutcomeContracts: Map<string, AgentOutcomeContract> | null = null
let agentOutcomeWarmup: Promise<void> | null = null
let outOfBandAgentIds: ReadonlySet<string> | null = null

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
    outOfBandAgentIds = null
    return
  }
  const resolved = new Map<string, AgentOutcomeContract>()
  // Built from the RAW snapshot, independently of `toAgentOutcomeContract`: an
  // agent whose declared schema this module cannot use still parks its step, and
  // dropping it here would hide the very mistake the check exists to catch.
  const suspending = new Set<string>()
  try {
    for (const snapshot of await bridge.listAgentOutcomeContracts()) {
      const contract = toAgentOutcomeContract(snapshot)
      if (contract && typeof snapshot.agentId === 'string') resolved.set(snapshot.agentId, contract)
      if (snapshot.suspends === true && typeof snapshot.agentId === 'string' && snapshot.agentId.length > 0) {
        suspending.add(snapshot.agentId)
      }
    }
  } catch {
    agentOutcomeContracts = new Map()
    outOfBandAgentIds = null
    return
  }
  agentOutcomeContracts = resolved
  outOfBandAgentIds = suspending
}

export async function ensureWorkflowAgentOutcomeContracts(container: ServiceContainer): Promise<void> {
  if (!agentOutcomeWarmup) agentOutcomeWarmup = loadAgentOutcomeContracts(container)
  await agentOutcomeWarmup
}

/**
 * Agent ids the peer reports as ANSWERING OUT OF BAND, for the server-side
 * parallel-branch authoring check (`lib/parallel-branch-agent-warnings.ts`).
 *
 * `null` means "not known here" and is deliberately distinct from an empty set:
 * this process was never warmed, the OPTIONAL `agent_orchestrator` peer is
 * absent, or the listing failed. Callers pass it straight through to
 * `evaluateWorkflowDefinition`, which reports NOTHING for `null` — unknown is
 * not "suspends", and a warning on every agent step would train authors to
 * ignore the Problems panel.
 *
 * An empty set is the honest answer of a peer that HAS a catalogue and holds no
 * out-of-band agent — including a bridge predating the `suspends` field, whose
 * snapshots all read as not-suspending. It reports nothing either.
 */
export function getWorkflowOutOfBandAgentIds(): ReadonlySet<string> | null {
  return outOfBandAgentIds
}

export function clearWorkflowAgentOutcomeContractsForTests(): void {
  agentOutcomeContracts = null
  agentOutcomeWarmup = null
  outOfBandAgentIds = null
}

export const resolveServerOutputContract: ResolveOutputContract = (activityType, config) => {
  const entry = getActivityType(activityType)
  const contract = entry?.outputContract
  if (typeof contract !== 'function') return 'unknown'
  const resolved = contract(config)
  if (!(resolved instanceof ZodType)) return 'unknown'
  return flattenSchemaToContract(resolved)
}
