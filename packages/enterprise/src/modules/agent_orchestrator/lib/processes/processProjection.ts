import type { EntityManager } from '@mikro-orm/postgresql'
import {
  ProcessInstance,
  AgentProposal,
  AgentRun,
  type ProcessInstanceStatus,
} from '../../data/entities'
import { processSubjectSchema, type ProcessSubject } from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'
import { declaredOutcomeOf, type ProcessOutcome } from '../tasks/outcome'
import { appendMilestoneReached, parseMilestonesReached } from '../tasks/milestones'

/**
 * Idempotent recompute-from-source maintenance of the `process_instances`
 * read model.
 *
 * This is a PROJECTION and it decides nothing. The `WorkflowInstance` is the one
 * lifecycle owner of a business execution; every field here — `status` included —
 * is derived from that instance, this module's own proposal/run rows and the
 * milestone events, and the row is fully rebuildable (`rebuild-processes` CLI).
 *
 * Every relevant event triggers a FULL recompute of the affected row rather than
 * an increment — an execution has at most dozens of rows, so the recompute is
 * cheap, and it makes the projection inherently idempotent and tolerant of
 * replayed or out-of-order events.
 */

export type ProjectionScope = { tenantId: string; organizationId: string }

/** Workflow-lifecycle terminal resolution requested by a lifecycle subscriber. */
export type TerminalSignal = 'completed' | 'failed' | 'cancelled'

/** The only thing this module asks of the `workflows` peer: read one instance. */
type WorkflowInstanceReader = {
  getWorkflowInstance: (
    em: EntityManager,
    instanceId: string,
  ) => Promise<{ tenantId?: string; organizationId?: string; context?: unknown } | null>
}

export type Resolver = { resolve: <T = unknown>(name: string) => T }

export type RecomputeOptions = {
  /** Subject descriptor carried on the triggering event (re-stamped when present). */
  subject?: ProcessSubject | null
  /** Terminal workflow-instance signal; resolves the terminal status. */
  terminal?: TerminalSignal
  /** Failure text from a terminal `failed` signal. */
  failureReason?: string | null
  /** Stage hint from a workflow lifecycle event (`stepId`); used when newer than agent data. */
  stageHint?: string | null
  /** Workflow identity hints (available on lifecycle payloads). */
  workflowId?: string | null
  workflowVersion?: string | null
  /**
   * Optional DI resolver, used ONLY to read the finished instance's declared
   * outcome from the optional `workflows` peer. Absent peer ⇒ no outcome, which
   * is a valid completion.
   */
  resolver?: Resolver | null
  /**
   * When true (default), missing rows are created. Workflow-lifecycle
   * subscribers pass false: an execution row exists once its process started it
   * or once an INVOKE_AGENT step produced agent activity, so a workflow that
   * involves no agents and no process definition never gets one.
   */
  createIfMissing?: boolean
}

const TERMINAL_STATUSES: ReadonlySet<ProcessInstanceStatus> = new Set([
  'auto_completed', 'completed', 'failed', 'cancelled',
])

function readFacetFlag(facets: unknown, key: string): boolean {
  if (!facets || typeof facets !== 'object') return false
  return (facets as Record<string, unknown>)[key] === true
}

/**
 * Status derivation — first match wins. Tier-A branches derive from agent data
 * alone; the terminal branches (tier B) fire only when a workflow-lifecycle
 * signal marked the execution terminal. Nothing here transitions a lifecycle: it
 * only reads one that already happened.
 */
export function deriveProcessStatus(input: {
  terminal: TerminalSignal | null
  subjectFraud: boolean | null
  subjectFacets: unknown
  pendingProposalCount: number
  dispositions: string[]
  latestDisposition: string | null
}): ProcessInstanceStatus {
  if (input.terminal === 'failed') return 'failed'
  if (input.terminal === 'cancelled') return 'cancelled'
  const pending = input.pendingProposalCount > 0
  if (input.subjectFraud === true && pending) return 'fraud_hold'
  if (pending && readFacetFlag(input.subjectFacets, 'docsRequested')) return 'docs_requested'
  if (pending && readFacetFlag(input.subjectFacets, 'questionOpen')) return 'question_open'
  if (pending) return 'waiting_on_you'
  if (input.terminal === 'completed') {
    const disposed = input.dispositions.filter((d) => d !== 'pending')
    const allAuto = disposed.length > 0 && disposed.every((d) => d === 'auto_approved')
    return allAuto ? 'auto_completed' : 'completed'
  }
  if (input.latestDisposition === 'auto_approved') return 'auto_completing'
  return 'running'
}

function tryResolveWorkflowInstanceReader(resolver: Resolver | null | undefined): WorkflowInstanceReader | null {
  if (!resolver) return null
  try {
    const executor = resolver.resolve<WorkflowInstanceReader | null>('workflowExecutor')
    return executor && typeof executor.getWorkflowInstance === 'function' ? executor : null
  } catch {
    return null
  }
}

/**
 * What the finished instance DECLARED it produced, under its context `outcome`
 * key. Best-effort: an execution that produced nothing (research, monitoring)
 * declares none and the outcome columns stay null by design.
 *
 * `getWorkflowInstance` is deliberately unscoped upstream, so the instance's own
 * tenant/organization is re-checked against the execution's scope before its
 * context is read — a forged instance id can never pull another tenant's context in.
 */
async function readDeclaredOutcome(
  em: EntityManager,
  resolver: Resolver | null | undefined,
  instanceId: string,
  scope: ProjectionScope,
): Promise<ProcessOutcome | null> {
  const reader = tryResolveWorkflowInstanceReader(resolver)
  if (!reader) return null
  try {
    const instance = await reader.getWorkflowInstance(em, instanceId)
    if (!instance) return null
    if (instance.tenantId !== scope.tenantId || instance.organizationId !== scope.organizationId) return null
    return declaredOutcomeOf(instance.context)
  } catch {
    return null
  }
}

export type RecomputeResult = { executionId: string; status: ProcessInstanceStatus } | null

/**
 * Recompute one execution row from proposals + runs and upsert it. Returns null
 * when there is no activity for the execution and `createIfMissing` is off (or
 * nothing to project at all). Emits `process.updated` (clientBroadcast,
 * best-effort) after a successful upsert.
 */
export async function recomputeProcessInstance(
  em: EntityManager,
  scope: ProjectionScope,
  workflowInstanceId: string,
  opts: RecomputeOptions = {},
): Promise<RecomputeResult> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const [proposals, runs, existing] = await Promise.all([
    em.find(
      AgentProposal,
      { ...where, workflowInstanceId, deletedAt: null },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'agentId', 'disposition', 'stepId', 'createdAt', 'updatedAt'],
      },
    ),
    em.find(
      AgentRun,
      { ...where, workflowInstanceId, deletedAt: null },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'agentId', 'costMinor', 'currency', 'stepId', 'createdAt', 'updatedAt'],
      },
    ),
    em.findOne(ProcessInstance, { ...where, workflowInstanceId, deletedAt: null }),
  ])

  const hasActivity = proposals.length > 0 || runs.length > 0
  if (!existing && !hasActivity) return null
  if (!existing && opts.createIfMissing === false) return null

  const pendingProposals = proposals.filter((p) => p.disposition === 'pending')
  const dispositions = proposals.map((p) => p.disposition)
  const latestProposal = proposals.length > 0 ? proposals[proposals.length - 1] : null

  const agentIds = Array.from(
    new Set([...runs.map((r) => r.agentId), ...proposals.map((p) => p.agentId)]),
  ).sort((a, b) => a.localeCompare(b))

  let costMinor: number | null = null
  let currency: string | null = null
  for (const run of runs) {
    if (run.costMinor == null) continue
    costMinor = (costMinor ?? 0) + Number(run.costMinor)
    if (!currency && run.currency) currency = run.currency
  }

  const timestamps = [...runs, ...proposals]
  // A row started by its process definition already knows when the EXECUTION was
  // entered — earlier than any agent activity — so its own stamp wins.
  const openedAt =
    existing?.openedAt ??
    (timestamps.length ? new Date(Math.min(...timestamps.map((row) => row.createdAt.getTime()))) : new Date())
  const lastActivityAt = timestamps.length
    ? new Date(Math.max(...timestamps.map((row) => (row.updatedAt ?? row.createdAt).getTime())))
    : existing?.lastActivityAt ?? new Date()

  // Latest known stage: an explicit lifecycle hint wins; otherwise the newest
  // agent-side stepId (proposals and runs both carry the workflow node id).
  const latestSteppedRow = [...proposals, ...runs]
    .filter((row) => !!row.stepId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .pop()
  const currentStage = opts.stageHint ?? latestSteppedRow?.stepId ?? existing?.currentStage ?? null

  // Subject: re-stamped whenever the triggering event carries one; a subject-less
  // later event never nulls out a previously stamped subject.
  const parsedSubject = opts.subject ? processSubjectSchema.safeParse(opts.subject) : null
  const subject = parsedSubject?.success ? parsedSubject.data : null

  // Terminal latch: once a row is terminal it can only change via an explicit
  // new terminal signal — a late agent event must not flip completed → running.
  const priorTerminal: TerminalSignal | null =
    existing && TERMINAL_STATUSES.has(existing.status)
      ? existing.status === 'failed'
        ? 'failed'
        : existing.status === 'cancelled'
          ? 'cancelled'
          : 'completed'
      : null

  const subjectFraud = subject?.fraud ?? existing?.subjectFraud ?? null
  const subjectFacets = subject?.facets ?? existing?.subjectFacets ?? null

  const status = deriveProcessStatus({
    terminal: opts.terminal ?? priorTerminal,
    subjectFraud,
    subjectFacets,
    pendingProposalCount: pendingProposals.length,
    dispositions,
    latestDisposition: latestProposal?.disposition ?? null,
  })

  const waitingSince =
    pendingProposals.length > 0 ? pendingProposals[0].createdAt : null

  const row = existing ?? em.create(ProcessInstance, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowInstanceId,
    openedAt,
  })
  row.workflowId = opts.workflowId ?? row.workflowId ?? null
  row.workflowVersion = opts.workflowVersion ?? row.workflowVersion ?? null
  if (subject) {
    row.subjectType = subject.subjectType ?? row.subjectType ?? null
    row.subjectId = subject.subjectId ?? row.subjectId ?? null
    row.subjectLabel = subject.subjectLabel ?? row.subjectLabel ?? null
    row.subjectTitle = subject.subjectTitle ?? row.subjectTitle ?? null
    row.subjectValueMinor = subject.valueMinor ?? row.subjectValueMinor ?? null
    row.subjectFraud = subject.fraud ?? row.subjectFraud ?? null
    row.subjectFacets = subject.facets ?? row.subjectFacets ?? null
    if (subject.currency && !row.currency) row.currency = subject.currency
  }
  row.status = status
  row.currentStage = currentStage
  row.agentIds = agentIds
  row.costMinor = costMinor
  if (currency) row.currency = currency
  row.runCount = runs.length
  row.pendingProposalCount = pendingProposals.length
  row.waitingSince = waitingSince
  row.openedAt = openedAt
  row.lastActivityAt = lastActivityAt

  // Terminal bookkeeping. The outcome is stamped ONCE, on the transition into a
  // terminal state, from what the finished instance DECLARED — nothing derives
  // one, and an absent declaration is a normal completion, not a missing write.
  if (opts.terminal && !priorTerminal) {
    row.completedAt = new Date()
    if (opts.terminal === 'failed' && opts.failureReason) row.failureReason = opts.failureReason
    if (opts.terminal === 'completed') {
      const produced = await readDeclaredOutcome(em, opts.resolver, workflowInstanceId, scope)
      if (produced) {
        row.outcomeType = produced.type
        row.outcomeId = produced.id
        row.outcomeLabel = produced.label ?? null
      }
    }
  }

  em.persist(row)
  await em.flush()

  // Best-effort live-list echo — a bus failure never fails the projection write.
  try {
    await emitAgentOrchestratorEvent('agent_orchestrator.process.updated', {
      id: row.id,
      workflowInstanceId: row.workflowInstanceId,
      status: row.status,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
    })
  } catch {
    // ignore
  }

  return { executionId: row.id, status: row.status }
}

/**
 * Records one business milestone a workflow emitted. Append-only and idempotent
 * per key — a retried step or a redelivered event must not make the business
 * narrative stutter.
 *
 * Deliberately NOT part of the recompute: a milestone is an event that HAPPENED,
 * not a value derivable from the current row, so it is the one field the
 * projection accumulates rather than recomputes.
 */
export async function recordMilestoneReached(
  em: EntityManager,
  scope: ProjectionScope,
  workflowInstanceId: string,
  milestone: { key: string; at?: string; data?: Record<string, unknown> | null },
): Promise<RecomputeResult> {
  const row = await em.findOne(ProcessInstance, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowInstanceId,
    deletedAt: null,
  })
  if (!row) return null

  const reached = parseMilestonesReached(row.milestonesReached)
  const next = appendMilestoneReached(reached, {
    key: milestone.key,
    at: milestone.at ?? new Date().toISOString(),
    data: milestone.data ?? null,
  })
  if (next === reached) return { executionId: row.id, status: row.status }

  row.milestonesReached = next
  row.lastActivityAt = new Date()
  em.persist(row)
  await em.flush()

  try {
    await emitAgentOrchestratorEvent('agent_orchestrator.process.updated', {
      id: row.id,
      workflowInstanceId: row.workflowInstanceId,
      status: row.status,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
    })
  } catch {
    // ignore
  }

  return { executionId: row.id, status: row.status }
}

type ScopedEventPayload = {
  tenantId?: unknown
  organizationId?: unknown
  workflowInstanceId?: unknown
}

/**
 * Shared subscriber entry: validates the payload scope, resolves the workflow
 * instance id (loading the run row when the event carries only a run id), and
 * recomputes. Fail-soft: malformed payloads and instance-less (playground)
 * activity are silently skipped — the projection only tracks workflow-anchored
 * executions.
 */
export async function recomputeFromEvent(
  em: EntityManager,
  payload: ScopedEventPayload & Record<string, unknown>,
  opts: RecomputeOptions & { resolveInstanceIdFromRunId?: string | null } = {},
): Promise<RecomputeResult> {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (!tenantId || !organizationId) return null

  let workflowInstanceId =
    typeof payload.workflowInstanceId === 'string' && payload.workflowInstanceId ? payload.workflowInstanceId : null
  if (!workflowInstanceId && opts.resolveInstanceIdFromRunId) {
    const run = await em.findOne(
      AgentRun,
      { id: opts.resolveInstanceIdFromRunId, tenantId, organizationId },
      { fields: ['id', 'workflowInstanceId'] },
    )
    workflowInstanceId = run?.workflowInstanceId ?? null
  }
  if (!workflowInstanceId) return null

  return recomputeProcessInstance(em, { tenantId, organizationId }, workflowInstanceId, opts)
}
