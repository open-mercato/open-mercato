import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { type AgentResult, type AgentProposalPayload, type GuardResults } from '../../data/validators'

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
  },
): Promise<string> {
  const { result } = await commandBus.execute<typeof input, { runId: string }>(
    'agent_orchestrator.runs.create',
    { input, ctx: commandCtx },
  )
  return result.runId
}

export async function completeRun(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: { runId: string; output: AgentResult; resultKind: 'informative' | 'actionable' },
): Promise<void> {
  await commandBus.execute<
    { runId: string; status: 'ok'; output: AgentResult; resultKind: 'informative' | 'actionable' },
    { runId: string }
  >('agent_orchestrator.runs.complete', {
    input: { runId: input.runId, status: 'ok', output: input.output, resultKind: input.resultKind },
    ctx: commandCtx,
  })
}

export async function failRun(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: { runId: string; errorMessage: string },
): Promise<void> {
  await commandBus.execute<{ runId: string; errorMessage: string }, { runId: string }>(
    'agent_orchestrator.runs.fail',
    { input, ctx: commandCtx },
  )
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
  },
): Promise<void> {
  await commandBus.execute('agent_orchestrator.proposals.create', { input, ctx: commandCtx })
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
