import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runAiAgentObject } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import {
  type AgentResult,
  type CitableSource,
  type GuardResults,
  type GuardrailSetBody,
  type UntrustedSpan,
} from '../../data/validators'
import { GuardrailService, persistVerdict, GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import { resolveCurrentGroundingSet } from '../guardrails/syncGroundingSets'
import { ContextResolverImpl, ContextModuleNotFoundError } from '../context/contextResolver'
import { resolveContextModule } from '../context/registry'
import { withRunContext } from './runContext'
import { runWithProviderBudget } from './providerBudget'
import {
  captureNativeRunTrace,
  isNativeTraceCaptureEnabled,
  type NativeStepRecord,
} from './nativeTraceCapture'
import {
  AgentGuardrailBlockedError,
  AgentOutputInvalidError,
  AgentRunTimeoutError,
} from './errors'
import {
  type AgentRunCtx,
  buildCommandContext,
  resolveCallerAcl,
  createRun,
  completeRun,
  failRun,
  createProposal,
  shapeResult,
} from './persistence'

/**
 * Default token budget for a TDCR context assembly when the caller does not pass
 * one (Phase 1 — the INVOKE_AGENT node config wires a per-capability budget in a
 * later phase). Conservative; the packer prunes optional fill that exceeds it.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4000

export type NativeAgentRunnerDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * The `native` runtime (lightweight-agent-runtime spec Phase 1) — the extracted
 * in-process engine that runs an agent in object mode under the caller scope,
 * validates the structured output against the agent's result schema, persists a
 * thin AgentRun (and, for actionable results, an AgentProposal) through the
 * audited Command path, and returns the typed AgentResult union. Dispatch
 * target for BOTH `runtime: 'native'` and the legacy `'in-process'` alias.
 *
 * Native additions over the pre-extraction `runInProcess`:
 * - `createRun` stamps `runtime: 'native'` + `externalRunId = runId`, so the
 *   post-run trace ingest upserts onto THIS row (never a shadow duplicate);
 * - every AI SDK step is recorded through the object-mode `loop.onStepFinish`
 *   hook and written post-run, best-effort, as `AgentSpan`/`AgentToolCall`
 *   rows (`OM_AGENT_TRACE_CAPTURE=off` escape hatch);
 * - the model call runs under the per-provider LLM budget (concurrency cap +
 *   429/overloaded retry with jittered backoff bounded by the run deadline).
 *
 * Propose-only is structural: the agent is declared read-only, so the AI runtime
 * strips every mutation tool — an agent may only READ (via its allowlisted tools,
 * when it declares any) and PROPOSE. The runner's only writes are AgentRun /
 * AgentProposal via Commands; domain writes happen later through the
 * proposal → disposition → effector path, never the agent itself.
 */
export class NativeAgentRunner {
  private readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: NativeAgentRunnerDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  async run(
    agentId: string,
    entry: AgentRegistryEntry,
    input: unknown,
    ctx: AgentRunCtx,
  ): Promise<AgentResult> {
    const commandCtx = buildCommandContext(this.container, ctx)

    const runId = await createRun(this.commandBus, commandCtx, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId,
      input,
      parentRunId: ctx.parentRunId ?? null,
      // `(runtime='native', externalRunId=runId)` is the trace-ingestion
      // idempotency key: the post-run span ingest upserts onto THIS row instead
      // of creating a forever-running shadow duplicate (spec decision H2).
      runtime: 'native',
      stampExternalRunIdFromId: true,
      model: entry.defaultModel ?? null,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
    })

    if (ctx.onRunPersisted) {
      try {
        ctx.onRunPersisted(runId)
      } catch (err) {
        console.warn(`[internal] onRunPersisted hook failed for "${agentId}":`, err)
      }
    }

    // Context overlay (Phase 1): assemble + persist one append-only
    // AgentContextBundle for this run BEFORE the model call (TDCR is on the
    // synchronous INVOKE_AGENT path). Called directly from the run path — there
    // is no pluggable workflow activity registry. Capability = the agent id. Only
    // capabilities that declare a ContextModule get a bundle; the rest are a safe
    // no-op so existing toolless agents are unaffected. Best-effort: an assembly
    // failure must not abort the run (the bundle is evidence, not a gate in P1).
    let untrustedSpans: UntrustedSpan[] = []
    let citableSources: CitableSource[] = []
    if (resolveContextModule(agentId)) {
      try {
        const contextEm = (this.container.resolve('em') as EntityManager).fork()
        const resolver = new ContextResolverImpl(this.container)
        const assembled = await resolver.assemble(contextEm, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          agentRunId: runId,
          processId: ctx.processId ?? null,
          stepId: ctx.stepId ?? null,
          capability: agentId,
          budget: DEFAULT_CONTEXT_TOKEN_BUDGET,
        })
        untrustedSpans = assembled.untrustedSpans
        citableSources = assembled.citableSources
      } catch (contextErr) {
        if (!(contextErr instanceof ContextModuleNotFoundError)) {
          console.warn(
            '[internal] agent_orchestrator: context assembly failed',
            contextErr instanceof Error ? contextErr.message : contextErr,
          )
        }
      }
    }

    // PRE-CALL input guardrail (Wave 3, Phase 3): screen the UNTRUSTED
    // document/retrieval spans assembled above for injected-instruction patterns
    // BEFORE the model call. A `block` persists the prompt_injection check + emits
    // `guardrail.tripped`, then fails the step with a typed reason (never reaches
    // disposition); a `warn`/`pass` records the audit rows and proceeds. The
    // always-on output tool-scope backstop holds even if this layer is evaded.
    const inputGuardrail = new GuardrailService(this.container)
    const inputVerdict = await inputGuardrail.checkInput({ capability: agentId, untrustedSpans })
    if (inputVerdict.checks.length > 0) {
      const inputGuardEm = (this.container.resolve('em') as EntityManager).fork()
      const inputScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId, agentRunId: runId }
      await persistVerdict({ em: inputGuardEm }, inputScope, {
        verdict: inputVerdict,
        capability: agentId,
        phase: 'input',
        proposalId: null,
      })
      if (inputVerdict.result === 'block' && inputVerdict.blockedReason) {
        const detail = '[internal] pre-call guardrail block (prompt_injection)'
        await failRun(this.commandBus, commandCtx, { runId, errorMessage: detail })
        throw new AgentGuardrailBlockedError(agentId, detail, {
          phase: inputVerdict.blockedReason.phase,
          kind: inputVerdict.blockedReason.kind,
          guardrailSetVersion: GUARDRAIL_SET_VERSION,
        })
      }
    }

    // Load the caller's effective ACL so the agent's read-only tools (e.g.
    // customers.get_deal, gated by customers.deals.view) pass their feature
    // check under the caller's own scope — never escalated. Defensive: if the
    // RBAC service is unavailable, fall back to no features (tool calls then
    // fail closed rather than running unauthorized).
    const acl = await resolveCallerAcl(this.container, ctx)
    const authContext: AiChatRequestContext = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
    }

    // Wall-clock deadline for the WHOLE model execution (performance hardening
    // Phase 2) — a hung provider call can never pin a worker slot forever.
    // The timer is cancellable + unref'd (same hygiene as openCodeAgentRunner).
    const runTimeoutMs = resolveNativeRunTimeoutMs()
    const deadline = createRunDeadline(runTimeoutMs)
    const deadlineAtMs = Date.now() + runTimeoutMs

    // Per-step trace recording (Phase 1): the object-mode `loop.onStepFinish`
    // hook (forwarded by the additive ai-assistant change) records one entry per
    // AI SDK step as it happens, so partial traces survive even a failed run.
    const traceEnabled = isNativeTraceCaptureEnabled()
    const stepRecords: NativeStepRecord[] = []
    const recordStep = async (event: unknown): Promise<void> => {
      const raw = event as {
        toolCalls?: Array<{
          toolName?: string
          args?: unknown
          result?: unknown
          experimental_toToolResultError?: { code?: string; message?: string }
          startTime?: number
          endTime?: number
        }>
        finishReason?: string
        usage?: { inputTokens?: number; outputTokens?: number }
        response?: { modelId?: string }
      }
      stepRecords.push({
        modelId: raw.response?.modelId ?? 'unknown',
        finishReason: raw.finishReason ?? 'stop',
        usage: {
          inputTokens: raw.usage?.inputTokens ?? 0,
          outputTokens: raw.usage?.outputTokens ?? 0,
        },
        toolCalls: (raw.toolCalls ?? []).map((toolCall) => ({
          toolName: toolCall.toolName ?? 'unknown',
          args: toolCall.args ?? {},
          result: toolCall.result,
          ...(toolCall.experimental_toToolResultError
            ? {
                error: {
                  code: String(toolCall.experimental_toToolResultError.code ?? 'unknown'),
                  message: String(toolCall.experimental_toToolResultError.message ?? ''),
                },
              }
            : {}),
          durationMs:
            typeof toolCall.startTime === 'number' && typeof toolCall.endTime === 'number'
              ? toolCall.endTime - toolCall.startTime
              : 0,
        })),
        endedAtMs: Date.now(),
      })
    }

    // Provider budget key: the same resolution the model call performs. Fail
    // open to a shared 'unknown' bucket — a resolution failure here must
    // surface from the model call itself, not the budget gate.
    const providerId = this.resolveProviderId(entry)

    const modelStartMs = Date.now()
    let rawObject: unknown
    let fallbackUsage: { inputTokens?: number; outputTokens?: number } | null = null
    const scheduleTraceCapture = (): void => {
      if (!traceEnabled) return
      // Fire-and-forget: the capture catches internally, but a defensive catch
      // here guarantees a rejected capture can never surface as an unhandled
      // rejection regardless of the capture implementation.
      captureNativeRunTrace(
        this.container,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        {
          runId,
          agentId,
          steps: stepRecords,
          startedAtMs: modelStartMs,
          endedAtMs: Date.now(),
          fallbackUsage,
          fallbackModel: entry.defaultModel ?? null,
        },
      ).catch((err: unknown) => {
        console.warn(
          `[internal] agent_orchestrator: native trace capture rejected for run "${runId}":`,
          err instanceof Error ? err.message : err,
        )
      })
    }
    try {
      // Bind this run's id as the current in-process run so a `delegate_agent`
      // tool call (from a sub-agent-capable agent) can stamp `parent_run_id` on
      // its nested run for traceability (Phase 4).
      const modelExecution = withRunContext(runId, () =>
        runWithProviderBudget({ providerId, deadlineAtMs }, async () => {
          const objectResult = await runAiAgentObject({
            agentId,
            input: typeof input === 'string' ? input : JSON.stringify(input),
            authContext,
            container: this.container,
            output: { schemaName: agentId.replace(/\W+/g, '_'), schema: entry.schema },
            // Propose-only agents stay read-only: run a read-only tool loop so the
            // agent can gather data (via its own tools or skill-contributed tools)
            // before proposing. The runtime auto-falls back to a plain structured
            // generate when no tools resolve, so toolless agents are unaffected.
            // Writes never execute directly (read-only policy + proposal → effector).
            enableTools: true,
            ...(traceEnabled ? { loop: { onStepFinish: recordStep } } : {}),
          })
          // Object mode defaults to `mode: 'generate'`, resolving `.object` directly.
          if (objectResult.mode === 'stream') {
            return await objectResult.object
          }
          fallbackUsage = objectResult.usage ?? null
          return objectResult.object
        }),
      )
      const raced = await Promise.race([
        modelExecution,
        deadline.promise.then(() => RUN_TIMED_OUT),
      ])
      if (raced === RUN_TIMED_OUT) {
        // The run is settled as timed out: swallow the late-arriving model
        // settle (result OR rejection) so it can neither complete the run nor
        // surface as an unhandled rejection.
        void modelExecution.then(
          () => undefined,
          () => undefined,
        )
        await failRun(this.commandBus, commandCtx, {
          runId,
          errorMessage: `[internal] agent run exceeded the ${runTimeoutMs}ms wall-clock deadline`,
        })
        throw new AgentRunTimeoutError(agentId, runTimeoutMs)
      }
      rawObject = raced
    } catch (err) {
      if (err instanceof AgentRunTimeoutError) {
        scheduleTraceCapture()
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: message })
      scheduleTraceCapture()
      throw err
    } finally {
      deadline.cancel()
    }

    // POST-CALL output guardrail hook (Phase 1): the per-capability proposal
    // contract IS the agent's declared outcome schema; the capability IS the
    // agentId. Schema-validity and a tool-scope backstop are recorded as
    // append-only AgentGuardrailCheck rows for full audit BEFORE the run can fail.
    // Resolve the capability's CURRENT grounding set (Wave 3, Phase 4). Present
    // only for capabilities declared factual + synced (setup.ts) — non-factual
    // capabilities resolve null and the grounding gate is skipped entirely. Read
    // through a forked EM, scoped by org; a resolution failure must not abort the
    // run (the other output checks still run), so it is best-effort.
    let grounding:
      | { set: GuardrailSetBody; groundingSetVersion: string; citableSources: CitableSource[] }
      | undefined
    try {
      const groundingEm = (this.container.resolve('em') as EntityManager).fork()
      const groundingSet = await resolveCurrentGroundingSet(
        groundingEm,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        agentId,
      )
      if (groundingSet) {
        grounding = {
          set: groundingSet.body as GuardrailSetBody,
          groundingSetVersion: groundingSet.version,
          citableSources,
        }
      }
    } catch (groundingErr) {
      console.warn(
        '[internal] agent_orchestrator: grounding set resolution failed',
        groundingErr instanceof Error ? groundingErr.message : groundingErr,
      )
    }

    const guardrailService = new GuardrailService(this.container)
    const verdict = await guardrailService.checkOutput({
      capability: agentId,
      schema: entry.schema,
      output: rawObject,
      allowedTools: entry.tools,
      grounding,
    })
    const guardEm = (this.container.resolve('em') as EntityManager).fork()
    const guardScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId, agentRunId: runId }

    const parsed = entry.schema.safeParse(rawObject)
    if (!parsed.success || verdict.result === 'block') {
      // Persist the block check(s) + emit `guardrail.tripped` BEFORE failing the
      // run, then preserve the existing AgentOutputInvalidError fail semantics.
      // Output checks at this point have no proposal yet → proposalId null.
      await persistVerdict({ em: guardEm }, guardScope, {
        verdict,
        capability: agentId,
        phase: 'output',
        proposalId: null,
      })
      const detail = parsed.success ? 'guardrail block' : parsed.error.message
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: detail })
      scheduleTraceCapture()
      const blocked = verdict.blockedReason
      if (blocked) {
        throw new AgentGuardrailBlockedError(agentId, detail, {
          phase: blocked.phase,
          kind: blocked.kind,
          guardrailSetVersion: GUARDRAIL_SET_VERSION,
        })
      }
      throw new AgentOutputInvalidError(agentId, detail)
    }

    // Pass/warn: persist the audit rows (one per check). A pass verdict records
    // pass rows but otherwise does NOT change behavior; warn proceeds + flags.
    const guardResults: GuardResults = await persistVerdict({ em: guardEm }, guardScope, {
      verdict,
      capability: agentId,
      phase: 'output',
      proposalId: null,
    })

    const result = shapeResult(entry.resultKind, parsed.data)

    await completeRun(this.commandBus, commandCtx, {
      runId,
      output: result,
      resultKind: entry.resultKind,
    })

    if (result.kind === 'actionable') {
      await createProposal(this.commandBus, commandCtx, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        agentId,
        runId,
        payload: result.proposal,
        confidence: result.proposal.confidence ?? null,
        processId: ctx.processId ?? null,
        stepId: ctx.stepId ?? null,
        guardResults,
      })
    }

    // Post-run, best-effort span persistence — after the audited persistence
    // tail so the hot path pays nothing and a capture failure changes nothing.
    scheduleTraceCapture()

    return result
  }

  /**
   * Resolve the provider id the model call will use, purely for the budget key.
   * Mirrors the model factory resolution `runAiAgentObject` performs; fails
   * open to `'unknown'` so budget-key resolution can never fail a run the
   * model call itself would have served.
   */
  private resolveProviderId(entry: AgentRegistryEntry): string {
    try {
      const factory = createModelFactory(this.container)
      const resolution = factory.resolveModel({
        moduleId: entry.moduleId,
        agentDefaultModel: entry.defaultModel,
        agentDefaultProvider: entry.defaultProvider,
      })
      return resolution.providerId
    } catch {
      return 'unknown'
    }
  }
}

const RUN_TIMED_OUT = Symbol('agent-run-timed-out')

/**
 * Wall-clock deadline for one native agent run. Mirrors the OpenCode
 * runner's `OM_OPENCODE_RUN_TIMEOUT_MS` semantics (default 5 minutes); read
 * lazily per run so deployments and tests can vary the env without a restart.
 */
const DEFAULT_NATIVE_RUN_TIMEOUT_MS = 5 * 60_000
function resolveNativeRunTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OM_AGENT_RUN_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_NATIVE_RUN_TIMEOUT_MS
}

/**
 * A cancellable wall-clock deadline (same hygiene as the OpenCode runner's):
 * `promise` resolves once `ms` elapses; `cancel()` clears the timer in the
 * caller's `finally` so a completed run leaks no timer. The timer is `unref`'d
 * so it never keeps the process alive on its own.
 */
function createRunDeadline(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
    const maybeUnref = timer as { unref?: () => void }
    if (typeof maybeUnref.unref === 'function') maybeUnref.unref()
  })
  return {
    promise,
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
