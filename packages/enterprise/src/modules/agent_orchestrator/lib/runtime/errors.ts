import type { GuardrailKindInput, GuardrailPhaseInput } from '../../data/validators'

/**
 * Typed agent-run error classes, extracted from `agentRuntime.ts` so both the
 * dispatch service and the `NativeAgentRunner` can import them without a
 * circular module edge. `agentRuntime.ts` re-exports every class, so existing
 * `from './agentRuntime'` / package-index imports are unchanged (BC).
 */

export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found'
  constructor(agentId: string) {
    super(`[internal] unknown agent id "${agentId}"`)
    this.name = 'AgentNotFoundError'
  }
}

/**
 * The in-process wall-clock deadline (`OM_AGENT_RUN_TIMEOUT_MS`, default 5 min —
 * symmetric with the OpenCode runner's `OM_OPENCODE_RUN_TIMEOUT_MS`) expired
 * before the model finished. The run is already marked failed via `failRun`
 * when this is thrown. Deterministic for a given deadline — NOT retryable.
 */
export class AgentRunTimeoutError extends Error {
  readonly code = 'agent_run_timeout'
  constructor(agentId: string, timeoutMs: number) {
    super(`[internal] agent "${agentId}" run exceeded the ${timeoutMs}ms wall-clock deadline`)
    this.name = 'AgentRunTimeoutError'
  }
}

export class AgentOutputInvalidError extends Error {
  readonly code: string = 'agent_output_invalid'
  constructor(agentId: string, detail: string) {
    super(`[internal] agent "${agentId}" produced output failing its result schema: ${detail}`)
    this.name = 'AgentOutputInvalidError'
  }
}

/**
 * A runtime guardrail `block` verdict. Carries the typed reason
 * `{ phase, kind, guardrailSetVersion }` so the workflow can route to retry /
 * escalate / USER_TASK. The schema-kind block subclasses AgentOutputInvalidError
 * to preserve the existing fail semantics callers/tests rely on (a schema-invalid
 * output is still an AgentOutputInvalidError).
 */
export class AgentGuardrailBlockedError extends AgentOutputInvalidError {
  override readonly code: string = 'agent_guardrail_blocked'
  readonly phase: GuardrailPhaseInput
  readonly kind: GuardrailKindInput
  readonly guardrailSetVersion: string
  constructor(
    agentId: string,
    detail: string,
    reason: { phase: GuardrailPhaseInput; kind: GuardrailKindInput; guardrailSetVersion: string },
  ) {
    super(agentId, detail)
    this.name = 'AgentGuardrailBlockedError'
    this.phase = reason.phase
    this.kind = reason.kind
    this.guardrailSetVersion = reason.guardrailSetVersion
  }
}
