/**
 * Run execution overlay (spec §8.3) — PURE.
 *
 * Answers one question for every surface that paints a finished or in-flight
 * run: which steps ran, how long each took, which routes were taken, and where
 * the instance is now. The instance detail page, the run Gantt and the Studio's
 * "Show last run" overlay all read this, so they can never disagree about what
 * a run did.
 *
 * No React, no ORM, no DI, no registry imports — the same rule
 * `lib/error-routing.ts` and `lib/context-ledger.ts` follow.
 *
 * Two inputs, deliberately ranked:
 *
 * - `StepInstance` rows are AUTHORITATIVE for step state. One row per step
 *   execution carries the status, both timestamps, the measured duration and
 *   the attempt count with no inference. There are also far fewer of them than
 *   there are events, which matters: the detail page reads the newest 100
 *   events, so on a long run the STEP_ENTERED of an early step falls off the
 *   page and an event-only derivation paints a completed step as never-run.
 * - `WorkflowEvent` rows are the fallback for step state and the ONLY source
 *   for the taken path — a transition leaves no row of its own.
 */

import type { StepRunStatus } from './status-colors'

/** Step-status vocabulary written by the engine, plus the legacy PascalCase spellings. */
const STEP_ENTERED_EVENT_TYPES = new Set(['STEP_ENTERED', 'StepEntered'])
const STEP_COMPLETED_EVENT_TYPES = new Set(['STEP_COMPLETED', 'STEP_EXITED', 'StepExited'])
const STEP_FAILED_EVENT_TYPES = new Set(['STEP_FAILED', 'StepFailed'])
const STEP_SKIPPED_EVENT_TYPES = new Set(['STEP_SKIPPED', 'StepSkipped'])
const TRANSITION_EXECUTED_EVENT_TYPES = new Set(['TRANSITION_EXECUTED', 'TransitionExecuted'])

export type RunEventInput = {
  eventType: string
  eventData?: Record<string, unknown> | null
  occurredAt: string | Date
}

export type RunStepInstanceInput = {
  id?: string
  stepId: string
  stepName?: string
  stepType?: string
  status: string
  branchInstanceId?: string | null
  inputData?: unknown
  outputData?: unknown
  errorData?: unknown
  enteredAt?: string | Date | null
  exitedAt?: string | Date | null
  executionTimeMs?: number | null
  retryCount?: number | null
}

export type StepRunState = {
  stepId: string
  status: StepRunStatus
  startedAt: Date | null
  completedAt: Date | null
  /** Measured by the engine when available, otherwise derived from the timestamps. */
  durationMs: number | null
  /** 1 for a step that ran once; `retryCount + 1` when the engine recorded retries. */
  attempts: number
}

export type TakenRoute = {
  transitionId: string | null
  fromStepId: string
  toStepId: string
  at: Date
}

export type RunExecution = {
  stepStates: Map<string, StepRunState>
  routes: TakenRoute[]
  takenTransitionIds: Set<string>
  /** `from->to` pairs, so a route whose transition id was never recorded still paints. */
  takenStepPairs: Set<string>
}

export type RunExecutionInput = {
  events?: readonly RunEventInput[]
  stepInstances?: readonly RunStepInstanceInput[]
  currentStepId?: string | null
  instanceStatus?: string | null
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readStringField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function stepPairKey(fromStepId: string, toStepId: string): string {
  return `${fromStepId}->${toStepId}`
}

/** Map the persisted `StepInstance.status` onto the canvas run vocabulary. */
export function stepInstanceStatusToRunStatus(status: string): StepRunStatus {
  switch (status) {
    case 'COMPLETED':
      return 'completed'
    case 'FAILED':
      return 'failed'
    case 'SKIPPED':
      return 'skipped'
    case 'ACTIVE':
      return 'active'
    case 'CANCELLED':
      return 'skipped'
    default:
      return 'pending'
  }
}

/**
 * A step can execute more than once in one run — a loop, a retry after a
 * failure route, or a rerun-from-step. The LATEST execution is the one the
 * canvas paints, so states are merged rather than overwritten blindly.
 */
function isNewerExecution(candidate: StepRunState, existing: StepRunState): boolean {
  const candidateAt = candidate.completedAt ?? candidate.startedAt
  const existingAt = existing.completedAt ?? existing.startedAt
  if (!existingAt) return true
  if (!candidateAt) return false
  return candidateAt.getTime() >= existingAt.getTime()
}

function stateFromStepInstance(stepInstance: RunStepInstanceInput): StepRunState {
  const startedAt = toDate(stepInstance.enteredAt)
  const completedAt = toDate(stepInstance.exitedAt)
  const measured =
    typeof stepInstance.executionTimeMs === 'number' && Number.isFinite(stepInstance.executionTimeMs)
      ? stepInstance.executionTimeMs
      : null
  const derived = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null
  const retries =
    typeof stepInstance.retryCount === 'number' && Number.isFinite(stepInstance.retryCount)
      ? Math.max(stepInstance.retryCount, 0)
      : 0
  return {
    stepId: stepInstance.stepId,
    status: stepInstanceStatusToRunStatus(stepInstance.status),
    startedAt,
    completedAt,
    durationMs: measured ?? derived,
    attempts: retries + 1,
  }
}

function mergeState(target: Map<string, StepRunState>, candidate: StepRunState): void {
  const existing = target.get(candidate.stepId)
  if (!existing || isNewerExecution(candidate, existing)) {
    target.set(candidate.stepId, candidate)
  }
}

function applyEvent(target: Map<string, StepRunState>, event: RunEventInput): void {
  const stepId = readStringField(event.eventData, 'stepId')
  if (!stepId) return
  const occurredAt = toDate(event.occurredAt)
  const existing = target.get(stepId)
  const base: StepRunState = existing ?? {
    stepId,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempts: 1,
  }

  if (STEP_ENTERED_EVENT_TYPES.has(event.eventType)) {
    // A re-entry starts a fresh execution: the previous terminal timestamps do
    // not describe the attempt now running.
    target.set(stepId, {
      ...base,
      startedAt: occurredAt,
      completedAt: null,
      durationMs: null,
      status: 'active',
    })
    return
  }

  const terminalStatus: StepRunStatus | null = STEP_COMPLETED_EVENT_TYPES.has(event.eventType)
    ? 'completed'
    : STEP_FAILED_EVENT_TYPES.has(event.eventType)
      ? 'failed'
      : STEP_SKIPPED_EVENT_TYPES.has(event.eventType)
        ? 'skipped'
        : null
  if (!terminalStatus) return

  const startedAt = base.startedAt
  target.set(stepId, {
    ...base,
    status: terminalStatus,
    completedAt: occurredAt,
    durationMs: startedAt && occurredAt ? occurredAt.getTime() - startedAt.getTime() : base.durationMs,
  })
}

/**
 * Paint the step the instance is parked on from the LIVE instance status: a
 * failed instance shows its current step red, a paused/waiting one yellow, an
 * otherwise-running one blue. Never overrides a step that already reached a
 * terminal state of its own.
 */
function applyLiveInstanceStatus(
  stepStates: Map<string, StepRunState>,
  currentStepId: string | null | undefined,
  instanceStatus: string | null | undefined
): void {
  if (!currentStepId) return
  const existing = stepStates.get(currentStepId)
  if (existing && (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'skipped')) {
    return
  }
  const liveStatus: StepRunStatus =
    instanceStatus === 'FAILED'
      ? 'failed'
      : instanceStatus === 'PAUSED' || instanceStatus === 'WAITING_FOR_ACTIVITIES'
        ? 'paused'
        : 'active'
  stepStates.set(currentStepId, {
    stepId: currentStepId,
    status: liveStatus,
    startedAt: existing?.startedAt ?? null,
    completedAt: null,
    durationMs: existing?.durationMs ?? null,
    attempts: existing?.attempts ?? 1,
  })
}

export function deriveRunExecution(input: RunExecutionInput): RunExecution {
  const stepStates = new Map<string, StepRunState>()
  const routes: TakenRoute[] = []
  const takenTransitionIds = new Set<string>()
  const takenStepPairs = new Set<string>()

  // Events come back newest-first from the API; replay them oldest-first so a
  // later terminal event wins over an earlier entry for the same step.
  const orderedEvents = [...(input.events ?? [])].sort((left, right) => {
    const leftAt = toDate(left.occurredAt)?.getTime() ?? 0
    const rightAt = toDate(right.occurredAt)?.getTime() ?? 0
    return leftAt - rightAt
  })

  for (const event of orderedEvents) {
    applyEvent(stepStates, event)

    if (!TRANSITION_EXECUTED_EVENT_TYPES.has(event.eventType)) continue
    const fromStepId = readStringField(event.eventData, 'fromStepId')
    const toStepId = readStringField(event.eventData, 'toStepId')
    if (!fromStepId || !toStepId) continue
    const transitionId = readStringField(event.eventData, 'transitionId')
    routes.push({
      transitionId,
      fromStepId,
      toStepId,
      at: toDate(event.occurredAt) ?? new Date(0),
    })
    if (transitionId) takenTransitionIds.add(transitionId)
    takenStepPairs.add(stepPairKey(fromStepId, toStepId))
  }

  // Step instances are authoritative and overwrite whatever the events implied.
  for (const stepInstance of input.stepInstances ?? []) {
    mergeState(stepStates, stateFromStepInstance(stepInstance))
  }

  applyLiveInstanceStatus(stepStates, input.currentStepId, input.instanceStatus)

  return { stepStates, routes, takenTransitionIds, takenStepPairs }
}

export type GraphNodeDescriptor = {
  id: string
  type?: string
}

/**
 * Resolve the status the canvas paints for one node, including the START/END
 * conventions a step-less node has no execution record for.
 */
export function resolveNodeRunStatus(
  execution: RunExecution,
  node: GraphNodeDescriptor,
  options: { currentStepId?: string | null; instanceStatus?: string | null } = {}
): StepRunStatus {
  const recorded = execution.stepStates.get(node.id)
  if (recorded) return recorded.status

  const isCurrentStep = options.currentStepId === node.id
  if (node.type === 'start') {
    return isCurrentStep ? 'active' : 'completed'
  }
  if (node.type === 'end') {
    return isCurrentStep || options.instanceStatus === 'COMPLETED' ? 'completed' : 'pending'
  }
  return 'pending'
}

/** Did this route carry the run? Matched by transition id first, endpoints second. */
export function isRouteTaken(
  execution: RunExecution,
  route: { transitionId?: string | null; fromStepId?: string | null; toStepId?: string | null }
): boolean {
  if (route.transitionId && execution.takenTransitionIds.has(route.transitionId)) return true
  if (!route.fromStepId || !route.toStepId) return false
  return execution.takenStepPairs.has(stepPairKey(route.fromStepId, route.toStepId))
}
