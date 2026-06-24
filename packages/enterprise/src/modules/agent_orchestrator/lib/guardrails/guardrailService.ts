import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodTypeAny } from 'zod'
import { AgentGuardrailCheck, type GuardrailPhase } from '../../data/entities'
import {
  guardrailVerdictSchema,
  type GuardrailVerdict,
  type GuardrailCheck,
  type GuardrailEvidence,
} from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'

/**
 * The versioned guardrail set that produced a verdict. Phase 1 stamps a constant
 * — the YAML→DB `agent_guardrail_sets` table (per-capability versioned config) is
 * deferred to a later phase. Recorded on every AgentGuardrailCheck for audit.
 */
export const GUARDRAIL_SET_VERSION = 'p1' as const

export type GuardrailScope = {
  tenantId: string
  organizationId: string
  agentRunId: string
}

export type CheckOutputArgs = {
  /** Capability = the agent id whose per-capability contract is being enforced. */
  capability: string
  /** The agent's declared outcome Zod schema (the per-capability proposal contract). */
  schema: ZodTypeAny
  /** The raw structured output produced by the model (object-mode). */
  output: unknown
  /**
   * The agent's effective read-only tool allowlist (the `ai_assistant` allowedTools
   * concept). Object-mode proposals carry NO tool calls, so the tool-scope check is
   * a structural backstop that always passes in Phase 1; the allowlist is threaded
   * so the same mechanism is reused, not a second policy engine.
   */
  allowedTools?: string[]
}

export type CheckInputArgs = {
  capability: string
  /** The assembled context to screen (pre-call). */
  context?: unknown
}

/**
 * Inject the persistence + emit seam so the service stays unit-testable: the
 * runtime supplies the forked EM and (optionally) a custom emitter; tests stub
 * both. Defaults to the module event emitter.
 */
export type GuardrailPersistDeps = {
  em: EntityManager
  emit?: typeof emitAgentOrchestratorEvent
}

const SCHEMA_EVIDENCE_CHAR_LIMIT = 2000

/** Worst severity across a set of checks (block > warn > pass). */
function worstResult(checks: GuardrailCheck[]): GuardrailVerdict['result'] {
  if (checks.some((check) => check.result === 'block')) return 'block'
  if (checks.some((check) => check.result === 'warn')) return 'warn'
  return 'pass'
}

/**
 * Phase 1 runtime guardrails: real-time POST-CALL output validation (schema +
 * tool-scope backstop) and a PRE-CALL input pass-through stub. Pure/deterministic
 * — no model calls. Verdicts are persisted as append-only AgentGuardrailCheck
 * rows and emit `guardrail.tripped` for block/warn results via `persistVerdict`.
 */
export class GuardrailService {
  constructor(private readonly container: AwilixContainer) {}

  /**
   * Phase 1 input gate is a pass-through stub: pre-call moderation/PII screening
   * lands in Phase 2. Returns a `pass` verdict with no checks so callers may wire
   * the hook now without changing behavior.
   */
  // Phase 2: moderation/PII — screen the assembled context here behind the
  // provider-agnostic moderation DI seam and emit `kind:'moderation'` checks.
  async checkInput(_args: CheckInputArgs): Promise<GuardrailVerdict> {
    return guardrailVerdictSchema.parse({ result: 'pass', checks: [] })
  }

  /**
   * POST-CALL output guardrails: validate the model output against the
   * per-capability Zod contract (kind `'schema'`) and run the tool-scope backstop
   * (kind `'tool_scope'`). Deterministic; no model calls.
   */
  async checkOutput(args: CheckOutputArgs): Promise<GuardrailVerdict> {
    const checks: GuardrailCheck[] = []

    // 1. Output-schema: the per-capability proposal contract IS the agent's
    //    declared outcome schema. A parse failure is a `block`.
    const parsed = args.schema.safeParse(args.output)
    if (parsed.success) {
      checks.push({ kind: 'schema', result: 'pass', guardrailSetVersion: GUARDRAIL_SET_VERSION })
    } else {
      const detail = parsed.error.message.slice(0, SCHEMA_EVIDENCE_CHAR_LIMIT)
      const evidence: GuardrailEvidence = { detail }
      checks.push({ kind: 'schema', result: 'block', guardrailSetVersion: GUARDRAIL_SET_VERSION, evidence })
    }

    // 2. Tool-scope backstop: object-mode proposals carry no tool calls, so this
    //    is structurally a pass. We reuse the `ai_assistant` allowedTools concept
    //    (threaded by the runtime) rather than building a second policy engine —
    //    a future read-only tool-loop / external runtime would surface a
    //    violation here. Documented pass-backstop for Phase 1.
    checks.push({ kind: 'tool_scope', result: 'pass', guardrailSetVersion: GUARDRAIL_SET_VERSION })

    const result = worstResult(checks)
    const blockedCheck = checks.find((check) => check.result === 'block')
    return guardrailVerdictSchema.parse({
      result,
      checks,
      ...(blockedCheck ? { blockedReason: { phase: 'output', kind: blockedCheck.kind } } : {}),
    })
  }
}

/**
 * Persist a verdict's checks as append-only AgentGuardrailCheck rows (one row per
 * check, exactly once) and emit `guardrail.tripped` for every `block`/`warn` check.
 * Output checks attach to the proposal (`proposalId`); input checks pass `null`
 * (spec: input checks have null proposalId, the proposal carries guardResults).
 * Returns the verdict's `checks` array to attach as the proposal's `guardResults`.
 *
 * Pure over the injected EM + emitter so it is unit-testable without a DB.
 */
export async function persistVerdict(
  deps: GuardrailPersistDeps,
  scope: GuardrailScope,
  args: {
    verdict: GuardrailVerdict
    capability: string
    phase: GuardrailPhase
    proposalId?: string | null
  },
): Promise<GuardrailCheck[]> {
  const { em } = deps
  const emit = deps.emit ?? emitAgentOrchestratorEvent
  const proposalId = args.proposalId ?? null

  for (const check of args.verdict.checks) {
    const row = em.create(AgentGuardrailCheck, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      agentRunId: scope.agentRunId,
      proposalId,
      guardrailSetVersion: check.guardrailSetVersion,
      capability: args.capability,
      phase: args.phase,
      kind: check.kind,
      result: check.result,
      evidence: check.evidence ?? null,
    })
    em.persist(row)
  }
  await em.flush()

  for (const check of args.verdict.checks) {
    if (check.result === 'pass') continue
    await emit(
      'agent_orchestrator.guardrail.tripped',
      {
        agentRunId: scope.agentRunId,
        proposalId,
        capability: args.capability,
        phase: args.phase,
        kind: check.kind,
        result: check.result,
        guardrailSetVersion: check.guardrailSetVersion,
      },
      { persistent: true },
    )
  }

  return args.verdict.checks
}
