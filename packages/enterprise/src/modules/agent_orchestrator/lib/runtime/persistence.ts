import type { AwilixContainer } from 'awilix'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { type AgentResult, type AgentProposalPayload, type AgentType, type GuardResults } from '../../data/validators'
import { normalizeProposalEnvelope } from '../../data/proposalEnvelope'
import { withAuditedCommand } from '../identity/agentWriteScope'

const logger = createLogger('agent_orchestrator').child({ component: 'agent-run-persistence' })

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
   * The INVOKE_AGENT step's declared `outputMapping` (T2.11). Only the `external`
   * runtime reads it, and only to SNAPSHOT it onto the correlation row: every
   * in-process runtime settles inside the call the workflow worker made, and that
   * worker applies the mapping itself once the bridge returns. A run that answers
   * out of band has no such caller left, so the mapping has to travel with the row
   * that outlives it. Additive and optional — absent means the legacy fixed keys,
   * exactly as before.
   */
  outputMapping?: Record<string, string>
  /**
   * Parent run id when this run is a nested sub-agent delegation (Phase 4 trace).
   * Additive + optional: top-level runs leave it undefined. The in-process
   * `delegate_agent` tool passes the parent run's id here so nested in-process
   * delegations are traceable via `agent_runs.parent_run_id`.
   */
  parentRunId?: string
  /**
   * Per-run wall-clock deadline override (ms). Delegated sub-agent runs pass a
   * SHORT budget here (see the `delegate_agent` tool) so a hung sub-agent tool
   * fails fast and cleanly, rather than blocking its parent orchestrator for the
   * full top-level run timeout. Undefined for top-level runs, which use
   * `OM_OPENCODE_RUN_TIMEOUT_MS` / the default.
   */
  runTimeoutMs?: number
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
    /** The agent's declared type (authoring fact); null when it declares none. */
    agentType?: AgentType | null
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
 * Persist the `agent_external_runs` correlation row that links a suspended run to
 * the provider answering it later. Goes through the audited Command path for the
 * same reason `createRun` does — and here it is not optional: the flush-time
 * no-bypass guard rejects any write reaching `em.flush()` under an agent-actor
 * scope that is not nested in an audited Command.
 */
export async function createExternalRunRow(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    tenantId: string
    organizationId: string
    runId: string
    agentId: string
    connectorId: string
    /** LOWERCASE SHA-256 hex digest of the callback token — never the token. */
    callbackTokenHash: string
    externalRunId?: string | null
    /** The workflow resume triple; all three or none (validator invariant, T2.1). */
    processId?: string | null
    stepId?: string | null
    signalName?: string | null
    /**
     * The parked step's declared `outputMapping`, snapshotted so the out-of-process
     * resume can land the answer in the author's own context keys (T2.11). Null for
     * a run with nothing parked behind it.
     */
    outputMapping?: Record<string, string> | null
    status?: 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled'
    expiresAt: Date
    requestPayload?: unknown
    resultPayload?: unknown
  },
): Promise<string> {
  const { result } = await withAuditedCommand(() =>
    commandBus.execute<typeof input, { externalRunRowId: string }>(
      'agent_orchestrator.external_runs.create',
      { input, ctx: commandCtx },
    ),
  )
  return result.externalRunRowId
}

/**
 * Read back the `outputMapping` snapshotted on a correlation row (T2.11).
 *
 * A READ rather than another field on the caller's row projection, deliberately.
 * `ExternalRunCorrelation` is a subset every entry point assembles for itself —
 * the token callback route, the connector-addressed route, the deadline sweep, the
 * synchronous connector arm — and a mapping that only reaches the resume when each
 * of them remembers to project one more column is a mapping that will silently go
 * missing on whichever path forgets. Reading it where it is USED makes the
 * guarantee hold for every caller, including ones written later.
 *
 * A PARTIAL projection: `output_mapping` is the only column selected, so this
 * never pulls the encrypted transcript columns back out of the database to answer
 * a question about configuration.
 *
 * Returns `null` for an absent row, an absent mapping OR a failed read — the
 * caller then writes the legacy fixed keys, which is what a row written before
 * this column existed means anyway. A resume must never fail because a mapping
 * could not be looked up: the answer is already screened and recorded, and leaving
 * the step parked over it would strand a live business process.
 */
export async function readExternalRunOutputMapping(
  container: AwilixContainer,
  scope: { externalRunRowId: string; tenantId: string; organizationId: string },
): Promise<Record<string, string> | null> {
  try {
    const { AgentExternalRun } = await import('../../data/entities')
    const em = (container.resolve('em') as PostgreSqlEntityManager).fork()
    const row = await em.findOne(
      AgentExternalRun,
      {
        id: scope.externalRunRowId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { fields: ['outputMapping'] },
    )
    const mapping = row?.outputMapping
    return mapping && typeof mapping === 'object' ? (mapping as Record<string, string>) : null
  } catch (error) {
    logger.warn('could not read the external run output mapping; falling back to the legacy context keys', {
      externalRunRowId: scope.externalRunRowId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Claim a `pending` correlation row for settlement — the single-shot gate every
 * external completion passes through. Returns `false` when the row was already
 * settled (a redelivered webhook, or a deadline sweep that got there first), in
 * which case the caller MUST NOT complete the run or resume the workflow again.
 *
 * Routed through the Command path by discipline rather than by force: unlike the
 * `createExternalRunRow` write, the callback half runs in a different process with
 * no agent-actor scope, so `AgentKindNoBypassSubscriber` would not fire here. Every
 * other write in this module's lifecycle is audited, and a status transition that
 * decides whether a workflow resumes is not the one to make an exception for.
 */
export async function claimExternalRunRow(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    externalRunRowId: string
    tenantId: string
    organizationId: string
    status: 'completed' | 'failed' | 'expired' | 'cancelled'
  },
): Promise<boolean> {
  const { result } = await withAuditedCommand(() =>
    commandBus.execute<typeof input, { claimed: boolean }>(
      'agent_orchestrator.external_runs.claim',
      { input, ctx: commandCtx },
    ),
  )
  return result.claimed
}

/**
 * Write the settlement outcome (final status + the encrypted result/failure
 * columns) onto an already-claimed correlation row.
 */
export async function settleExternalRunRow(
  commandBus: CommandBus,
  commandCtx: CommandRuntimeContext,
  input: {
    externalRunRowId: string
    tenantId: string
    organizationId: string
    status: 'completed' | 'failed' | 'expired' | 'cancelled'
    resultPayload?: unknown
    failureReason?: string | null
  },
): Promise<boolean> {
  const { result } = await withAuditedCommand(() =>
    commandBus.execute<typeof input, { settled: boolean }>(
      'agent_orchestrator.external_runs.settle',
      { input, ctx: commandCtx },
    ),
  )
  return result.settled
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
    resultKind: 'researcher' | 'proposal'
    /** Proposal confidence for proposal results; researcher runs have no confidence semantics. */
    confidence?: number | null
  } & RunUsageStamp,
): Promise<void> {
  await withAuditedCommand(() =>
    commandBus.execute<
      {
        runId: string
        status: 'ok'
        output: AgentResult
        resultKind: 'researcher' | 'proposal'
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
export function shapeResult(
  resultKind: 'researcher' | 'proposal',
  data: unknown,
  agentId?: string,
): AgentResult {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (resultKind === 'researcher') {
    return { kind: 'researcher', data: 'data' in record ? record.data : data }
  }
  // An agent's OUTCOME schema is authored per agent and may still declare the
  // pre-envelope `{ actions, confidence, rationale }` shape. Lifting it here — by the
  // SAME rule the backfill migration applies — is what makes the option envelope the
  // one persisted contract without rewriting every agent's declared OUTCOME.
  const proposal = normalizeProposalEnvelope(record.proposal ?? data, agentId)
  return { kind: 'proposal', proposal }
}
