import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentProcess,
  AgentProposal,
  AgentRun,
  type AgentProcessStatus,
} from '../../data/entities'
import { agentProcessSubjectSchema, type AgentProcessSubject } from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'

/**
 * Idempotent recompute-from-source maintenance of the `agent_processes`
 * read-model (process subject & caseload projection spec, 2026-06-25).
 *
 * Every relevant event triggers a FULL recompute of the affected process row
 * from the module's own proposals/runs tables rather than an increment — a
 * process has at most dozens of rows, so the recompute is cheap, and it makes
 * the projection inherently idempotent and tolerant of replayed or out-of-order
 * events. The projection is a rebuildable cache (see the `rebuild-processes`
 * CLI): it never decides disposition or workflow state.
 */

export type ProjectionScope = { tenantId: string; organizationId: string }

/** Workflow-lifecycle terminal resolution requested by a Phase-B subscriber. */
export type TerminalSignal = 'completed' | 'failed' | 'cancelled'

export type RecomputeOptions = {
  /** Subject descriptor carried on the triggering event (re-stamped when present). */
  subject?: AgentProcessSubject | null
  /** Terminal workflow-instance signal (Phase B); resolves the terminal status. */
  terminal?: TerminalSignal
  /** Stage hint from a workflow lifecycle event (`stepId`); used when newer than agent data. */
  stageHint?: string | null
  /** Workflow identity hints (available on lifecycle payloads). */
  workflowId?: string | null
  workflowVersion?: string | null
  /**
   * When true (default), missing rows are created. Workflow-lifecycle
   * subscribers pass false: a process exists only once an INVOKE_AGENT step has
   * produced agent activity, so non-agent workflows never get projection rows.
   */
  createIfMissing?: boolean
}

const TERMINAL_STATUSES: ReadonlySet<AgentProcessStatus> = new Set([
  'auto_completed', 'completed', 'failed', 'cancelled',
])

function readFacetFlag(facets: unknown, key: string): boolean {
  if (!facets || typeof facets !== 'object') return false
  return (facets as Record<string, unknown>)[key] === true
}

/**
 * Status derivation — the spec's precedence table, first match wins. Tier-A
 * branches derive from agent data alone; the terminal branches (tier B) fire
 * only when a workflow-lifecycle signal marked the process terminal.
 */
export function deriveProcessStatus(input: {
  terminal: TerminalSignal | null
  subjectFraud: boolean | null
  subjectFacets: unknown
  pendingProposalCount: number
  dispositions: string[]
  latestDisposition: string | null
}): AgentProcessStatus {
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

export type RecomputeResult = { processRowId: string; status: AgentProcessStatus } | null

/**
 * Recompute one process row from proposals + runs and upsert it. Returns null
 * when there is no agent activity for the process and `createIfMissing` is off
 * (or nothing to project at all). Emits `process.updated` (clientBroadcast,
 * best-effort) after a successful upsert.
 */
export async function recomputeAgentProcess(
  em: EntityManager,
  scope: ProjectionScope,
  processId: string,
  opts: RecomputeOptions = {},
): Promise<RecomputeResult> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const [proposals, runs, existing] = await Promise.all([
    em.find(
      AgentProposal,
      { ...where, processId, deletedAt: null },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'agentId', 'disposition', 'stepId', 'createdAt', 'updatedAt'],
      },
    ),
    em.find(
      AgentRun,
      { ...where, processId, deletedAt: null },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'agentId', 'costMinor', 'currency', 'stepId', 'createdAt', 'updatedAt'],
      },
    ),
    em.findOne(AgentProcess, { ...where, processId, deletedAt: null }),
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
  const openedAt = timestamps.length
    ? new Date(Math.min(...timestamps.map((row) => row.createdAt.getTime())))
    : existing?.openedAt ?? new Date()
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
  const parsedSubject = opts.subject ? agentProcessSubjectSchema.safeParse(opts.subject) : null
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

  const row = existing ?? em.create(AgentProcess, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    processId,
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
  em.persist(row)
  await em.flush()

  // Best-effort live-list echo — a bus failure never fails the projection write.
  try {
    await emitAgentOrchestratorEvent('agent_orchestrator.process.updated', {
      id: row.id,
      processId: row.processId,
      status: row.status,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
    })
  } catch {
    // ignore
  }

  return { processRowId: row.id, status: row.status }
}

type ScopedEventPayload = {
  tenantId?: unknown
  organizationId?: unknown
  processId?: unknown
}

/**
 * Shared subscriber entry: validates the payload scope, resolves the process id
 * (loading the run row when the event carries only a run id), and recomputes.
 * Fail-soft: malformed payloads and processless (playground) activity are
 * silently skipped — the projection only tracks workflow-anchored processes.
 */
export async function recomputeFromEvent(
  em: EntityManager,
  payload: ScopedEventPayload & Record<string, unknown>,
  opts: RecomputeOptions & { resolveProcessIdFromRunId?: string | null } = {},
): Promise<RecomputeResult> {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (!tenantId || !organizationId) return null

  let processId = typeof payload.processId === 'string' && payload.processId ? payload.processId : null
  if (!processId && opts.resolveProcessIdFromRunId) {
    const run = await em.findOne(
      AgentRun,
      { id: opts.resolveProcessIdFromRunId, tenantId, organizationId },
      { fields: ['id', 'processId'] },
    )
    processId = run?.processId ?? null
  }
  if (!processId) return null

  return recomputeAgentProcess(em, { tenantId, organizationId }, processId, opts)
}
