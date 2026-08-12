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

/**
 * The registry entry names a runtime this build does not know how to execute.
 *
 * Before external agents existed, `agentRuntime.run()` sent everything that was
 * not `'opencode'` to the native runner. That fallthrough is a trap once a
 * registry entry can carry `runtime: 'external'`: the native runner would try to
 * run an agent that has no system prompt, no model and no tools as an in-process
 * LLM call, burn a model call on an empty prompt, and fail on schema validation —
 * an error that says nothing about the real cause. Refusing loudly is the only
 * honest answer for a runtime nobody registered a runner for.
 *
 * Deterministic for a given registry entry, so NOT retryable: re-running cannot
 * make an unknown runtime known.
 */
export class UnknownAgentRuntimeError extends Error {
  readonly code = 'unknown_agent_runtime'
  readonly retryable = false
  readonly runtime: string
  constructor(agentId: string, runtime: string) {
    super(`[internal] agent "${agentId}" declares unknown runtime "${runtime}"`)
    this.name = 'UnknownAgentRuntimeError'
    this.runtime = runtime
  }
}

/**
 * An external agent cannot be started because its wiring is incomplete: the entry
 * names no connector, or names one no process registered.
 *
 * A connector is registered from a provider module's `di.ts` while the agent is
 * registered from `ai-agents.ts`, and the two are deliberately independent (the
 * unauthenticated callback route needs the connector without needing the agent
 * registry). There is therefore no ordering guarantee at registration time, which
 * is why `defineExternalAgent` cannot validate `connectorId` and the check lands
 * here, at run time.
 *
 * This is a DEPLOYMENT mistake — the provider package is missing or its `di.ts`
 * never ran — not a transient fault, so it is not retryable and it is raised
 * BEFORE any run row is opened: retrying it would only produce more failed runs
 * against an agent that never executed.
 */
export class ExternalAgentConfigurationError extends Error {
  readonly code = 'external_agent_misconfigured'
  readonly retryable = false
  readonly reason: 'connector_not_declared' | 'connector_missing' | 'deadline_missing' | 'callback_base_url_missing'
  constructor(
    agentId: string,
    reason: ExternalAgentConfigurationError['reason'],
    detail: string,
  ) {
    super(`[internal] external agent "${agentId}" cannot start (${reason}): ${detail}`)
    this.name = 'ExternalAgentConfigurationError'
    this.reason = reason
  }
}

/**
 * An external run STARTED and will answer out of band, raised by the
 * `agentRuntime.run()` compatibility surface for callers whose return type has no
 * room for a suspension. The workflow bridge does not see this — it calls
 * `runOrSuspend()` and maps the suspended outcome onto the parked step.
 *
 * `retryable = false` is load-bearing, for the reason T1.2 recorded on the
 * parallel-branch refusal: a suspension means the external effector ALREADY RAN,
 * so a retry places a second phone call. Any caller that retries on failure must
 * see a structural refusal, not an ordinary error.
 */
export class AgentRunSuspendedError extends Error {
  readonly code = 'agent_run_suspended'
  readonly retryable = false
  readonly runId: string
  readonly externalRunId: string
  constructor(agentId: string, runId: string, externalRunId: string) {
    super(
      `[internal] agent "${agentId}" started an external run that answers out of band; ` +
        `this caller cannot receive a suspended outcome (runId=${runId})`,
    )
    this.name = 'AgentRunSuspendedError'
    this.runId = runId
    this.externalRunId = externalRunId
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
