/**
 * Authoring an EXTERNAL agent (external-agent-invocation design §5.4).
 *
 * An external agent runs at a third-party provider — an outbound voice call, a
 * remote A2A worker — and answers minutes later through a verified callback. It
 * registers into the SAME registry `defineAgent` and `registerFileAgent` write
 * to, so everything downstream keeps working with no change at all: the agents
 * cockpit lists it (the `external` runtime label already exists in both API
 * enums, the list filter and all four locale files), `listAgentOutcomeContracts()`
 * projects its OUTCOME schema, and the workflows context ledger types
 * `outputMapping: { call: 'data.transcript' }` in the Studio's variable picker.
 *
 * Like `registerFileAgent`, it goes STRAIGHT into the registry and produces no
 * `AiAgentDefinition`: an external agent never runs in this process, so there is
 * no system prompt, no model and no tool loop to define here. Its prompt lives
 * with the provider; its credentials live per-tenant in the `integrations`
 * credential store and are resolved by the connector at `start()`, never here —
 * the registry is process-global and must never hold tenant secrets (design §7, R7).
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseDuration } from '@open-mercato/core/modules/workflows/lib/duration'
import type { ZodTypeAny } from 'zod'
import type { AgentType } from '../../data/validators'
import { registerFileAgent, type AgentFact, type AgentRegistryEntry, type AgentResultKind } from './defineAgent'
import { resolveAgentOutcomeZod } from './agentOutcomeContract'

const logger = createLogger('agent_orchestrator').child({ component: 'define-external-agent' })

export interface DefineExternalAgentInput {
  /** 'module.agent' — STABLE contract id (see BACKWARD_COMPATIBILITY.md). */
  id: string
  moduleId: string
  label: string
  description: string
  /** Id of the registered `ExternalAgentConnector` that starts and settles this agent's runs. */
  connectorId: string
  /**
   * The result envelope, exactly as `defineAgent` takes it:
   * `z.object({ kind: z.literal('researcher'), data: <outcome> })`.
   *
   * `kind` MUST be `'researcher'` in this pass — see the governance gate below.
   */
  result: { kind: AgentResultKind; schema: ZodTypeAny }
  /**
   * How long to wait for the provider's callback, as a duration string the
   * platform already understands (`'30m'`, `'PT30M'`, `'2h'`, `'P1D'`).
   * Mandatory: without a deadline a call nobody answers parks the workflow
   * forever (design §7, R2).
   */
  timeout: string
  /** Declared agent type (authoring fact). May legitimately differ from `result.kind`. */
  agentType?: AgentType
  /**
   * Operator-facing notes about what the provider-side agent is instructed to
   * do. Purely documentation: the real prompt lives at the provider, so this is
   * whatever helps someone reading the cockpit understand the agent. Defaults to
   * the empty string, which the agent detail route already renders.
   */
  instructions?: string
  /** Optional Playground "Insert sample" input. */
  sampleInput?: unknown
  /** Optional Caseload fact declarations (see `defineAgent`). */
  facts?: AgentFact[]
}

/**
 * Register an external agent. Returns the registered entry (handy for tests and
 * for a provider package that wants to assert its own registration); the
 * registry is the source of truth either way.
 */
export function defineExternalAgent(input: DefineExternalAgentInput): AgentRegistryEntry {
  // GOVERNANCE GATE (design §3, rule 1). External agents are researcher-kind
  // ONLY in this pass. A `proposal` result carries a confidence that
  // `DispositionService` compares against `autoApproveThreshold` — so an
  // external proposal agent would let a THIRD PARTY's self-reported confidence
  // auto-approve a domain write through our effector. That is a deliberate
  // Phase-3-at-the-earliest decision, and it fails CLOSED here rather than being
  // silently downgraded: a silently-accepted proposal agent reads to whoever
  // authored it as a granted capability.
  if (input.result.kind !== 'researcher') {
    throw new Error(
      `[internal] external agent "${input.id}" declares result.kind "${input.result.kind}"; external agents must be researcher — an external proposal would let a third party's confidence auto-approve a domain write`,
    )
  }

  if (!input.connectorId.trim()) {
    throw new Error(`[internal] external agent "${input.id}" must name a connectorId`)
  }

  const callbackTimeoutMs = resolveCallbackTimeoutMs(input.id, input.timeout)

  const entry: AgentRegistryEntry = {
    id: input.id,
    moduleId: input.moduleId,
    resultKind: 'researcher',
    agentType: input.agentType,
    schema: input.result.schema,
    // An external agent calls no OM tools, loads no skills and delegates to
    // nobody — it is a remote effector we asked a question. Empty, not absent,
    // because every consumer of the registry reads these as arrays.
    tools: [],
    skills: [],
    subAgents: [],
    label: input.label,
    description: input.description,
    instructions: input.instructions ?? '',
    runtime: 'external',
    connectorId: input.connectorId,
    callbackTimeoutMs,
    sampleInput: input.sampleInput,
    facts: input.facts,
  }

  // `defineAgent`'s convention is that `result.schema` IS the envelope, and
  // `resolveAgentOutcomeZod` reads the inner `data` off it. An agent that passes
  // the INNER shape by mistake still registers and still runs, but it would
  // vanish from `listAgentOutcomeContracts()` and its outputMapping would stop
  // autocompleting in the Studio — a silent loss that is hard to trace back
  // here. Warn rather than throw, matching `agentOutcomeContract`'s documented
  // "degrade honestly rather than guess" stance.
  if (!resolveAgentOutcomeZod(entry)) {
    logger.warn(
      'external agent result schema is not the declared { kind, data } envelope; its OUTCOME contract will not be projected to the workflows ledger',
      { agentId: input.id },
    )
  }

  // Same single write path (and same duplicate-id guard) as every other agent.
  registerFileAgent(entry)
  return entry
}

/**
 * Parse the authored deadline.
 *
 * Reuses core's `parseDuration` so an external agent's `timeout` accepts exactly
 * the vocabulary a workflow author already types into `WAIT`, `WAIT_FOR_SIGNAL`
 * and task SLAs — one duration grammar across the platform rather than a second,
 * subtly-different one. The static import is safe despite `workflows` being an
 * optional peer everywhere else in this module: `lib/duration.ts` is a
 * zero-import, side-effect-free leaf (unlike `activity-registry`, which
 * registers the builtin activity types on import), and `@open-mercato/core` is a
 * hard dependency of `@open-mercato/enterprise`. The RUNTIME bridge into
 * `workflows` — `sendSignal`, the disposition task, the safe-command catalogue —
 * stays dynamic-import-only, as before.
 */
function resolveCallbackTimeoutMs(agentId: string, timeout: string): number {
  let milliseconds: number
  try {
    milliseconds = parseDuration(timeout)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[internal] external agent "${agentId}" has an unparseable timeout "${timeout}": ${detail}`)
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(`[internal] external agent "${agentId}" has a non-positive timeout "${timeout}"`)
  }
  return milliseconds
}

