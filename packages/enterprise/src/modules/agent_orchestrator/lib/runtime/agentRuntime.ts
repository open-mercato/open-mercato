import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runAiAgentObject } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getAgentEntry, ensureAgentsLoaded, type AgentRegistryEntry } from '../sdk/defineAgent'
import { type AgentResult, type CitableSource, type GuardResults, type GuardrailKindInput, type GuardrailPhaseInput, type GuardrailSetBody, type UntrustedSpan } from '../../data/validators'
import { GuardrailService, persistVerdict, GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import { resolveCurrentGroundingSet } from '../guardrails/syncGroundingSets'
import { ContextResolverImpl, ContextModuleNotFoundError } from '../context/contextResolver'
import { resolveContextModule } from '../context/registry'
import { OpenCodeAgentRunner } from './openCodeAgentRunner'
import { withRunContext } from './runContext'
import { withAgentActor } from '../identity/agentWriteScope'
import { registerAgentKindNoBypassSubscriber } from '../identity/agentNoBypassSubscriber'
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

export type { AgentRunCtx } from './persistence'

export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found'
  constructor(agentId: string) {
    super(`[internal] unknown agent id "${agentId}"`)
    this.name = 'AgentNotFoundError'
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

export type AgentRuntimeDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * Default token budget for a TDCR context assembly when the caller does not pass
 * one (Phase 1 — the INVOKE_AGENT node config wires a per-capability budget in a
 * later phase). Conservative; the packer prunes optional fill that exceeds it.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4000

/**
 * In-process runtime that runs an agent in object mode under the caller scope,
 * validates the structured output against the agent's result schema, persists a
 * thin AgentRun (and, for actionable results, an AgentProposal) through the
 * audited Command path, and returns the typed AgentResult union.
 *
 * Propose-only is structural: the agent is declared read-only, so the AI runtime
 * strips every mutation tool — an agent may only READ (via its allowlisted tools,
 * when it declares any) and PROPOSE. The runtime's only writes are AgentRun /
 * AgentProposal via Commands; domain writes happen later through the
 * proposal → disposition → effector path, never the agent itself.
 */
export class AgentRuntimeService {
  readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: AgentRuntimeDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  async run(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    await ensureAgentsLoaded()
    const entry = getAgentEntry(agentId)
    if (!entry) throw new AgentNotFoundError(agentId)

    // Runtime no-bypass enforcement (Wave 4 Phase 3, layer B-b). When the run is
    // bound to a provisioned agent principal (`ctx.runAs`), bind the async-scoped
    // agent-actor context for the WHOLE run and register the fail-closed flush-time
    // subscriber on the EM. From here on any write reaching `em.flush()` that is
    // NOT inside the agent's own audited Command write throws — making a raw
    // `em.flush()` bypass impossible at runtime. Unprincipalled (legacy/playground)
    // runs keep their prior behavior (no actor scope, guard never fires).
    const dispatch = (): Promise<AgentResult> => {
      // Dispatch on the agent's declared runtime. File-defined (OpenCode) agents
      // run on the OpenCode runtime via a dedicated runner; everything else uses
      // the existing in-process object-mode path (unchanged).
      if (entry.runtime === 'opencode') {
        const runner = new OpenCodeAgentRunner({
          container: this.container,
          commandBus: this.commandBus,
          openCodeClient: this.container.resolve('openCodeClient'),
        })
        return runner.run(entry, input, ctx)
      }
      return this.runInProcess(agentId, entry, input, ctx)
    }

    if (ctx.runAs) {
      try {
        registerAgentKindNoBypassSubscriber(this.container.resolve('em') as EntityManager)
      } catch {
        // best-effort registration; the actor scope below still fails closed for
        // any EM that did get the subscriber (the shared request EM).
      }
      return withAgentActor(
        { agentUserId: ctx.runAs.agentUserId, onBehalfOfUserId: ctx.runAs.onBehalfOfUserId ?? null },
        dispatch,
      )
    }
    return dispatch()
  }

  private async runInProcess(
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
      // In-process runs have no external session id, so only the runtime is
      // stamped. The `(runtime, externalRunId)` unique index allows multiple
      // nulls, so leaving externalRunId null is correct here.
      runtime: 'in-process',
      model: entry.defaultModel ?? null,
    })

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

    let rawObject: unknown
    try {
      // Bind this run's id as the current in-process run so a `delegate_agent`
      // tool call (from a sub-agent-capable agent) can stamp `parent_run_id` on
      // its nested run for traceability (Phase 4).
      const objectResult = await withRunContext(runId, () =>
        runAiAgentObject({
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
        }),
      )
      // Object mode defaults to `mode: 'generate'`, resolving `.object` directly.
      rawObject = objectResult.mode === 'stream' ? await objectResult.object : objectResult.object
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: message })
      throw err
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

    return result
  }
}
