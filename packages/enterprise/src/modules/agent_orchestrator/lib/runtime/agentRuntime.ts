import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runAiAgentObject } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getAgentEntry, ensureAgentsLoaded, type AgentRegistryEntry } from '../sdk/defineAgent'
import { type AgentResult, type GuardResults, type GuardrailKindInput, type GuardrailPhaseInput } from '../../data/validators'
import { GuardrailService, persistVerdict, GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import { OpenCodeAgentRunner } from './openCodeAgentRunner'
import { withRunContext } from './runContext'
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
    const guardrailService = new GuardrailService(this.container)
    const verdict = await guardrailService.checkOutput({
      capability: agentId,
      schema: entry.schema,
      output: rawObject,
      allowedTools: entry.tools,
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
