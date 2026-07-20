import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { type AgentResult, type AgentProposalPayload, type GuardResults } from '../../data/validators'
import { withAuditedCommand } from '../identity/agentWriteScope'

/**
 * Shared persistence + scope helpers used by BOTH agent runtimes (in-process
 * `AgentRuntimeService` and `OpenCodeAgentRunner`) so the AgentRun/AgentProposal
 * lifecycle, command-context shape, and result shaping stay byte-for-byte
 * identical across paths. Extracted so the OpenCode runner reuses the exact
 * tail the in-process path already proved, rather than duplicating it.
 */

export type AgentRunCtx = {
  tenantId: string
  organizationId: string
  userId: string
  /** Set for workflow-originated runs (area 02) → stamped onto the AgentProposal; null for the playground. */
  processId?: string
  stepId?: string
  /**
   * Parent run id when this run is a nested sub-agent delegation (Phase 4 trace).
   * Additive + optional: top-level runs leave it undefined. The in-process
   * `delegate_agent` tool passes the parent run's id here so nested in-process
   * delegations are traceable via `agent_runs.parent_run_id`.
   */
  parentRunId?: string
  /**
   * On-behalf-of attribution (Agent Identity & On-Behalf-Of, Wave 4 P2). When the
   * run executes under a provisioned agent principal, this carries the agent's
   * `auth.User` id (the actor stamped on every write) and the invoking human's
   * `auth.User` id (recorded as `onBehalfOfUserId`). When set, `buildCommandContext`
   * threads it onto `CommandRuntimeContext.runAs` so the audited Command path
   * attributes every ActionLog to the agent on behalf of the human, with
   * `sourceKey='agent'`. Omitted for legacy/playground runs (no principal yet),
   * which keep the prior `ctx.userId`-derived attribution.
   */
  runAs?: AgentRunAs
  /**
   * Invoked by both runners immediately after the AgentRun row is created, with
   * the new run id — lets a caller (e.g. the playground run route) learn the run
   * id without changing `agentRuntime.run`'s return type. Nested sub-agent
   * delegations that inherit the ctx fire it again with the child run id, so a
   * caller wanting the top-level run must keep the FIRST invocation only.
   * Runners invoke it inside try/catch: a throwing hook is logged, never fatal.
   */
  onRunPersisted?: (runId: string) => void
  /**
   * Marks the whole run tree as production traffic or an eval replay. Threaded
   * into BOTH the AgentRun and any AgentProposal the run produces, so a replay's
   * records are born tagged rather than patched afterwards — there is no window in
   * which an eval proposal looks like operator work, and nested sub-agent
   * delegations inherit the tag automatically because they inherit this ctx.
   */
  source?: 'runtime' | 'eval'
}

export type AgentRunAs = {
  /** The provisioned agent principal's `auth.User` id — actor on every write. */
  agentUserId: string
  /** The invoking human's `auth.User` id, or null for system-invoked agent runs. */
  onBehalfOfUserId?: string | null
}

export function buildCommandContext(
  container: AwilixContainer,
  ctx: AgentRunCtx,
): CommandRuntimeContext {
  return {
    container,
    auth: {
      sub: ctx.userId,
      tenantId: ctx.tenantId,
      orgId: ctx.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
    // When the run is bound to a provisioned agent principal, every ActionLog the
    // command path writes is attributed to the agent (actor) on behalf of the
    // human, sourced `'agent'` — through the SAME audited path, no parallel route.
    ...(ctx.runAs
      ? {
          runAs: {
            actorUserId: ctx.runAs.agentUserId,
            onBehalfOfUserId: ctx.runAs.onBehalfOfUserId ?? null,
            source: 'agent' as const,
          },
        }
      : {}),
  }
}

export async function resolveCallerAcl(
  container: AwilixContainer,
  ctx: AgentRunCtx,
): Promise<{ features: string[]; isSuperAdmin: boolean }> {
  try {
    const rbac = container.resolve('rbacService') as {
      loadAcl: (
        userId: string,
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<{ isSuperAdmin: boolean; features: string[] }>
    }
    const loaded = await rbac.loadAcl(ctx.userId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    return { features: loaded.features ?? [], isSuperAdmin: !!loaded.isSuperAdmin }
  } catch {
    return { features: [], isSuperAdmin: false }
  }
}

export async function createRun(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    tenantId: string
    organizationId: string
    agentId: string
    input: unknown
    /** Nested sub-agent run trace (Phase 4); omit/null for top-level runs. */
    parentRunId?: string | null
    /**
     * Runtime that produced this run + its runtime-native run id — the
     * trace-ingestion idempotency key `(runtime, externalRunId)`. Stamped at
     * creation so a later trace POST upserts THIS row. Optional/nullable: the
     * in-process path has no external session id, so it stamps `runtime` only.
     */
    runtime?: string | null
    externalRunId?: string | null
    /** Native runtime: pre-generate the run uuid and stamp `externalRunId = id` in one insert (spec H2). */
    stampExternalRunIdFromId?: boolean
    /** Declared model id (e.g. `anthropic/claude-sonnet-4-5`); null when the agent uses the tenant default. */
    model?: string | null
    /** Workflow process instance + step this run belongs to (INVOKE_AGENT); links the run to the process in traces. */
    processId?: string | null
    stepId?: string | null
    /** `eval` marks a replay so it never skews the agent's production metrics. */
    source?: 'runtime' | 'eval'
  },
): Promise<string> {
  // Audited-command scope (Phase 3, layer B-b): the agent's own AgentRun write
  // goes through the audited Command path, so it passes the flush-time no-bypass
  // guard while a raw `em.flush()` under the same agent actor would throw.
  const { result } = await withAuditedCommand(() =>
    commandBus.execute<typeof input, { runId: string }>(
      'agent_orchestrator.runs.create',
      { input, ctx: commandCtx },
    ),
  )
  return result.runId
}

/**
 * Optional usage/cost stamp attached at a run's terminal transition (data-honesty
 * spec §3.2). Absent fields leave the run columns untouched, so pre-existing
 * callers are byte-for-byte unaffected. Cost is the caller-computed ESTIMATE
 * from `modelPricing.ts` — stored once, never recomputed at read time.
 */
export type RunUsageStamp = {
  inputTokens?: number | null
  outputTokens?: number | null
  costMinor?: number | null
  currency?: string | null
}

export async function completeRun(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    runId: string
    output: AgentResult
    resultKind: 'informative' | 'actionable'
    /** Proposal confidence for actionable results; informative runs have no confidence semantics. */
    confidence?: number | null
  } & RunUsageStamp,
): Promise<void> {
  await withAuditedCommand(() =>
    commandBus.execute<
      {
        runId: string
        status: 'ok'
        output: AgentResult
        resultKind: 'informative' | 'actionable'
        confidence?: number | null
      } & RunUsageStamp,
      { runId: string }
    >('agent_orchestrator.runs.complete', {
      input: {
        runId: input.runId,
        status: 'ok',
        output: input.output,
        resultKind: input.resultKind,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...pickUsageStamp(input),
      },
      ctx: commandCtx,
    }),
  )
}

export async function failRun(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: { runId: string; errorMessage: string } & RunUsageStamp,
): Promise<void> {
  await withAuditedCommand(() =>
    commandBus.execute<{ runId: string; errorMessage: string } & RunUsageStamp, { runId: string }>(
      'agent_orchestrator.runs.fail',
      {
        input: { runId: input.runId, errorMessage: input.errorMessage, ...pickUsageStamp(input) },
        ctx: commandCtx,
      },
    ),
  )
}

function pickUsageStamp(input: RunUsageStamp): RunUsageStamp {
  const stamp: RunUsageStamp = {}
  if (input.inputTokens !== undefined) stamp.inputTokens = input.inputTokens
  if (input.outputTokens !== undefined) stamp.outputTokens = input.outputTokens
  if (input.costMinor !== undefined) stamp.costMinor = input.costMinor
  if (input.currency !== undefined) stamp.currency = input.currency
  return stamp
}

export async function createProposal(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    tenantId: string
    organizationId: string
    agentId: string
    runId: string
    payload: AgentProposalPayload
    confidence: number | null
    processId: string | null
    stepId: string | null
    /** Output-phase guardrail verdict checks attached at creation (Phase 1). */
    guardResults?: GuardResults | null
    /** `eval` keeps a replay proposal out of the operator caseload permanently. */
    source?: 'runtime' | 'eval'
  },
): Promise<void> {
  await withAuditedCommand(() =>
    commandBus.execute('agent_orchestrator.proposals.create', { input, ctx: commandCtx }),
  )
}

/**
 * The agent `result.schema` already produces the AgentResult shape (an object
 * with `kind` plus `data` or `proposal`). We re-key by the declared `resultKind`
 * so the persisted output/proposal is always well-formed even if a schema omits
 * the literal `kind` discriminator.
 */
export function shapeResult(resultKind: 'informative' | 'actionable', data: unknown): AgentResult {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (resultKind === 'informative') {
    return { kind: 'informative', data: 'data' in record ? record.data : data }
  }
  const proposal = (record.proposal ?? data) as AgentProposalPayload
  return { kind: 'actionable', proposal }
}
