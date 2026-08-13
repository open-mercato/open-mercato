import type { AwilixContainer } from 'awilix'
import type { ZodTypeAny } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProposal } from '../../data/entities'
import { ensureAgentsLoaded, listAgentEntries } from '../sdk/defineAgent'
import { resolveAgentOutcomeZod } from '../sdk/agentOutcomeContract'
import { agentProcessSubjectSchema, type AgentProcessSubject } from '../../data/validators'
import type { AgentRuntimeService } from './agentRuntime'
import type { AgentRunAs } from './persistence'
import { resolveAgentPrincipal } from '../identity/agentPrincipalService'
import { withProcessSubject } from '../processes/subjectContext'
import type {
  AgentDispositionReview,
  DispositionService,
  DispositionOnResult,
} from '../disposition/dispositionService'

/**
 * DI bridge consumed by the workflows `INVOKE_AGENT` activity executor. It keeps
 * all `AgentProposal` access inside `agent_orchestrator` so the workflows module
 * never imports this module's entities (workflows treats it as an optional peer
 * resolved via `tryResolve('agentWorkflowBridge')`).
 */
export type InvokeAgentForWorkflowArgs = {
  agentId: string
  input: unknown
  onResult: DispositionOnResult
  ctx: {
    tenantId: string
    organizationId: string
    userId?: string
    processId: string
    stepId: string
    /**
     * The INVOKE_AGENT node's already-interpolated `subject` descriptor (process
     * projection spec, 2026-06-25). Additive + optional: forwarded opaquely into
     * the async-scoped subject binding so `proposals.create` can attach it to
     * the `proposal.created` event payload. Never persisted on run/proposal rows.
     */
    subject?: unknown
    /**
     * The INVOKE_AGENT node's already-resolved Review section (spec §7.5): who
     * reviews the proposal this step raises, and by when. Additive + optional —
     * absent means the unassigned disposition task this service raised before
     * the section existed. Resolution (interpolation, dynamic-assignee fallback)
     * happens in the workflows engine, which owns the run context; this module
     * only carries the answer onto the task it creates.
     */
    review?: AgentDispositionReview
    /**
     * The INVOKE_AGENT node's declared `outputMapping` (tracker T2.11). Additive
     * and optional, and consumed by exactly ONE runtime: `external`, which
     * snapshots it onto the correlation row so the provider's callback — another
     * process, minutes later — resumes the step in the author's own context keys.
     * Every settled path ignores it here, because core's activity worker applies
     * `mapAgentResultToContext` itself once this bridge returns.
     *
     * Mirrors the optional field core added to BOTH of its duck-typed copies of
     * this args type; nothing type-checks across that boundary.
     */
    outputMapping?: Record<string, string>
  }
}

export type InvokeAgentForWorkflowOutcome =
  | { kind: 'researcher'; data: unknown }
  | { kind: 'auto_approved'; proposalId: string; payload: unknown }
  | { kind: 'user_task'; proposalId: string }
  /**
   * The agent returned an EMPTY option set — it looked and had nothing to propose.
   * Terminal like `researcher`: the step resumes instead of parking on a decision
   * nobody can make, and routes onto the researcher outcome handle.
   */
  | { kind: 'none_proposed'; proposalId: string; payload: unknown }
  /**
   * The agent STARTED but answers out of band — an `external` runtime whose
   * provider calls back minutes later. Nothing has been produced yet: no result,
   * no proposal, and possibly never a proposal at all. The workflows engine parks
   * the step on the proposal-ready signal and the provider's verified callback
   * (`completeExternalRun`) is what eventually fires it.
   *
   * Field names and optionality mirror core's own duck-typed copies of this union
   * (`workflows/lib/activity-executor.ts` and `.../activity-worker-handler.ts`)
   * exactly — nothing type-checks across that optional-peer boundary.
   */
  | { kind: 'suspended'; runId: string; externalRunId?: string }

/**
 * One agent's declared OUTCOME contract, as the workflows context ledger needs
 * it: the result kind decides whether the OUTCOME lands under the envelope's
 * `data` or `proposalPayload` key, and the schema types everything below it.
 */
export type AgentOutcomeContractSnapshot = {
  agentId: string
  resultKind: 'researcher' | 'proposal'
  schema: ZodTypeAny
  /**
   * The agent ANSWERS OUT OF BAND: `invokeAgentForWorkflow` returns
   * `{ kind: 'suspended' }` for it and the workflows engine parks the step until
   * something outside this process settles it.
   *
   * OPTIONAL, exactly as `listAgentOutcomeContracts` itself is — an older or
   * third-party bridge that never sets it stays a valid implementation, and core
   * treats its absence as "not known here" and reports nothing.
   *
   * It names the PROPERTY, not the runtime that has it. Core's author-time check
   * cares only that the answer arrives later, so a second runtime that also
   * parks is covered here without core learning another of this module's runtime
   * names — the same reason the bridge is duck-typed in the first place.
   */
  suspends?: boolean
}

export interface AgentWorkflowBridge {
  invokeAgentForWorkflow(
    args: InvokeAgentForWorkflowArgs,
  ): Promise<InvokeAgentForWorkflowOutcome>
  /**
   * OUTCOME contracts of every registered agent, for the workflows INVOKE_AGENT
   * output contract. OPTIONAL on the interface so an older bridge implementation
   * stays valid — core treats its absence as "agents cannot be typed here" and
   * falls back to `unknown` ledger entries.
   */
  listAgentOutcomeContracts?(): Promise<AgentOutcomeContractSnapshot[]>
}

export type AgentWorkflowBridgeDeps = {
  container: AwilixContainer
  agentRuntime: AgentRuntimeService
  dispositionService: DispositionService
}

export class AgentWorkflowBridgeService implements AgentWorkflowBridge {
  private readonly container: AwilixContainer
  private readonly agentRuntime: AgentRuntimeService
  private readonly dispositionService: DispositionService

  constructor(deps: AgentWorkflowBridgeDeps) {
    this.container = deps.container
    this.agentRuntime = deps.agentRuntime
    this.dispositionService = deps.dispositionService
  }

  async invokeAgentForWorkflow(
    args: InvokeAgentForWorkflowArgs,
  ): Promise<InvokeAgentForWorkflowOutcome> {
    const { agentId, input, onResult, ctx } = args

    // On-behalf-of attribution (Wave 4 P2): if this agent has a provisioned
    // principal, run as the agent (actor) on behalf of the invoking human, so
    // every ActionLog the run writes is attributed agent→human, sourced 'agent',
    // through the SAME audited Command path. When no principal is provisioned yet
    // the run keeps its prior `userId`-derived attribution (additive, fail-open).
    const runAs = await this.resolveRunAs(agentId, ctx)

    // Subject binding (fail-open): a malformed descriptor is dropped, never a
    // reason to refuse the run — the projection then simply lists the process
    // by workflow name with no business facets.
    const subject = this.parseSubject(ctx.subject)

    // `runOrSuspend`, not `run`: `run` keeps its settled-`AgentResult` signature
    // and throws the non-retryable `AgentRunSuspendedError` on a suspension, which
    // from here would FAIL the step instead of parking it. This bridge is the one
    // caller that can genuinely park, so it takes the outcome surface.
    //
    // `processId` / `stepId` are what let the external runner write an
    // all-or-nothing resume triple (process + step + signal) onto the correlation
    // row — the only way the callback, in another process, can find the step to
    // wake. They are already threaded above and must stay.
    const runOutcome = await withProcessSubject(subject, () =>
      this.agentRuntime.runOrSuspend(agentId, input, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId ?? '',
        processId: ctx.processId,
        stepId: ctx.stepId,
        // Threaded for the same reason `processId` / `stepId` are: they are what
        // let the external runner write a row the callback can resume from, and
        // this is what tells that resume WHERE to put the answer.
        ...(ctx.outputMapping ? { outputMapping: ctx.outputMapping } : {}),
        ...(runAs ? { runAs } : {}),
      }),
    )

    // Return BEFORE the proposal lookup and before disposition. Both assume the
    // run produced something: the lookup would find no `pending` proposal for this
    // step and throw '[internal] agent proposal not found after run', turning a
    // correctly parked call into a failed step — and `dispose` has nothing to
    // dispose of. The answer arrives through the callback, not through here.
    if (runOutcome.kind === 'suspended') {
      return {
        kind: 'suspended',
        runId: runOutcome.runId,
        ...(runOutcome.externalRunId ? { externalRunId: runOutcome.externalRunId } : {}),
      }
    }

    const result = runOutcome.result

    if (result.kind === 'researcher') {
      return { kind: 'researcher', data: result.data }
    }

    const em = (this.container.resolve('em') as EntityManager).fork()
    // `none_proposed` is stamped at creation for an empty option set, so the lookup
    // must accept it too — otherwise the run that proposed nothing looks like a run
    // whose proposal went missing.
    const proposal = await em.findOne(
      AgentProposal,
      {
        processId: ctx.processId,
        stepId: ctx.stepId,
        disposition: { $in: ['pending', 'none_proposed'] },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      { orderBy: { createdAt: 'DESC' } },
    )
    if (!proposal) {
      throw new Error('[internal] agent proposal not found after run')
    }

    const outcome = await this.dispositionService.dispose(proposal, onResult, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      processId: ctx.processId,
      stepId: ctx.stepId,
      ...(ctx.review ? { review: ctx.review } : {}),
    })

    if (outcome.kind === 'auto_approved') {
      return { kind: 'auto_approved', proposalId: outcome.proposalId, payload: proposal.payload }
    }
    if (outcome.kind === 'none_proposed') {
      return { kind: 'none_proposed', proposalId: outcome.proposalId, payload: proposal.payload }
    }
    return { kind: 'user_task', proposalId: outcome.proposalId }
  }

  /**
   * Projects the agent registry into OUTCOME contracts for the workflows module.
   * Agents load lazily, so this awaits the registry first; an agent whose result
   * schema is not the declared envelope contributes nothing rather than a guess.
   *
   * `suspends` is the ONE fact core cannot derive from the definition it is
   * validating, and this is the only server-side seam that can carry it — which
   * is what lets core's parallel-branch check run for the definitions API and
   * the AI draft agent, not only for a human with the Studio open.
   */
  async listAgentOutcomeContracts(): Promise<AgentOutcomeContractSnapshot[]> {
    await ensureAgentsLoaded()
    const contracts: AgentOutcomeContractSnapshot[] = []
    for (const entry of listAgentEntries()) {
      const schema = resolveAgentOutcomeZod(entry)
      if (!schema) continue
      contracts.push({
        agentId: entry.id,
        resultKind: entry.resultKind,
        schema,
        suspends: entry.runtime === 'external',
      })
    }
    return contracts
  }

  private parseSubject(raw: unknown): AgentProcessSubject | null {
    if (!raw || typeof raw !== 'object') return null
    const parsed = agentProcessSubjectSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  /**
   * Resolves the on-behalf-of attribution for an `INVOKE_AGENT` run. Returns the
   * agent principal's `auth.User` id (actor) + the invoking human (`onBehalfOfUserId`)
   * when the agent is provisioned and enabled; null otherwise (fail-open — the run
   * keeps its `userId`-derived attribution until a principal exists). Org-scoped.
   */
  private async resolveRunAs(
    agentId: string,
    ctx: InvokeAgentForWorkflowArgs['ctx'],
  ): Promise<AgentRunAs | null> {
    const principal = await resolveAgentPrincipal(
      this.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      agentId,
    )
    if (!principal || !principal.enabled) return null
    return {
      agentUserId: principal.userId,
      onBehalfOfUserId: ctx.userId ?? null,
    }
  }
}
