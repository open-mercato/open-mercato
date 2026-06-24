import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodTypeAny } from 'zod'
import { AgentGuardrailCheck, type GuardrailPhase } from '../../data/entities'
import {
  guardrailVerdictSchema,
  type GuardrailVerdict,
  type GuardrailCheck,
  type GuardrailEvidence,
  type UntrustedSpan,
  type AttemptedTool,
} from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'
import {
  detectSpanInjection,
  injectionEvidence,
  scoreToResult,
  type InjectionRiskResult,
} from './promptInjection'

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
   * concept, threaded by the runtime). The tool-scope check reuses THIS allowlist
   * rather than building a second policy engine. Object-mode proposals carry no
   * tool calls, so when `attemptedTools` is empty the check is a structural pass;
   * when a tool/action IS attempted it is the HARD backstop ("LLM proposes, OM
   * disposes") — an attempt outside this allowlist `block`s regardless of how it
   * was elicited (untrusted document text can NEVER authorize a tool call).
   */
  allowedTools?: string[]
  /**
   * Tool/action attempts surfaced by the runtime for the tool-scope backstop. Empty
   * for pure object-mode proposals (structural pass). The agent's mutation policy is
   * `read-only` (propose-only), so any `isMutation` attempt blocks even if it is on
   * the read allowlist.
   */
  attemptedTools?: AttemptedTool[]
}

export type CheckInputArgs = {
  capability: string
  /**
   * The UNTRUSTED `document`/`retrieval` spans assembled by the Wave-2
   * ContextResolver. Screened in-memory for injected-instruction patterns; the raw
   * text NEVER reaches evidence. Trusted `entity` spans are not passed here.
   */
  untrustedSpans?: UntrustedSpan[]
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
   * PRE-CALL input gate (Wave 3, Phase 3): screen the UNTRUSTED `document`/
   * `retrieval` spans for injected-instruction patterns via the deterministic
   * detector (GAP-08 layer 2). Each flagged span raises a risk score; the worst
   * score across spans maps to a single `prompt_injection` check (`block`/`warn`).
   * No untrusted spans → a `pass` verdict with no checks (toolless / entity-only
   * runs are unaffected). Deterministic; no model calls (the escalated model judge,
   * GAP-08 layer 3, is dark-launched behind a flag and not wired here).
   *
   * Evidence is POINTERS ONLY — provenance locators + matched rule ids, never raw
   * span text. (Phase 2 moderation/PII screening composes here later as additional
   * `kind:'moderation'`/`kind:'pii'` checks behind the same gate.)
   */
  async checkInput(args: CheckInputArgs): Promise<GuardrailVerdict> {
    const spans = args.untrustedSpans ?? []
    const checks: GuardrailCheck[] = []

    if (spans.length > 0) {
      const verdicts = spans.map((span) => detectSpanInjection(span))
      const worstScore = verdicts.reduce((max, verdict) => Math.max(max, verdict.score), 0)
      const result: InjectionRiskResult = scoreToResult(worstScore)
      const check: GuardrailCheck = {
        kind: 'prompt_injection',
        result,
        guardrailSetVersion: GUARDRAIL_SET_VERSION,
        ...(result !== 'pass' ? { evidence: injectionEvidence(verdicts) } : {}),
      }
      checks.push(check)
    }

    const result = worstResult(checks)
    const blockedCheck = checks.find((check) => check.result === 'block')
    return guardrailVerdictSchema.parse({
      result,
      checks,
      ...(blockedCheck ? { blockedReason: { phase: 'input', kind: blockedCheck.kind } } : {}),
    })
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

    // 2. Tool-scope HARD backstop (Wave 3, Phase 3): reuse the `ai_assistant`
    //    allowedTools allowlist + the read-only mutation policy rather than a second
    //    policy engine. Object-mode proposals carry no tool calls, so with no
    //    attempted tools this is a structural pass. When the runtime DOES surface a
    //    tool/action attempt, ANY attempt outside the allowlist — or any mutation
    //    attempt at all under the propose-only `read-only` policy — `block`s
    //    regardless of how it was elicited. This is the layer that holds even if the
    //    injection detector is fully evaded: untrusted document text can never reach
    //    a raw-write tool ("LLM proposes, OM disposes").
    checks.push(this.checkToolScope(args.attemptedTools ?? [], args.allowedTools ?? []))

    const result = worstResult(checks)
    const blockedCheck = checks.find((check) => check.result === 'block')
    return guardrailVerdictSchema.parse({
      result,
      checks,
      ...(blockedCheck ? { blockedReason: { phase: 'output', kind: blockedCheck.kind } } : {}),
    })
  }

  /**
   * Tool-scope backstop check. Deterministic; reuses the `ai_assistant` allowlist
   * (read-only tools the agent may call) under the propose-only `read-only`
   * mutation policy. A `block` is produced when ANY attempted tool is either not on
   * the allowlist or is a mutation tool (which the `read-only` policy forbids
   * outright). Evidence names the offending tool id only (an allowlist key, never
   * untrusted data). No attempts → structural `pass`.
   */
  private checkToolScope(attempted: AttemptedTool[], allowedTools: string[]): GuardrailCheck {
    const allowed = new Set(allowedTools)
    const offending = attempted.find(
      (tool) => tool.isMutation === true || !allowed.has(tool.name),
    )
    if (!offending) {
      return { kind: 'tool_scope', result: 'pass', guardrailSetVersion: GUARDRAIL_SET_VERSION }
    }
    const reason = offending.isMutation
      ? 'mutation tool blocked by read-only policy'
      : 'tool not on capability allowlist'
    const evidence: GuardrailEvidence = {
      detail: `tool_scope: ${reason}`,
      tool: offending.name,
    }
    return { kind: 'tool_scope', result: 'block', guardrailSetVersion: GUARDRAIL_SET_VERSION, evidence }
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
