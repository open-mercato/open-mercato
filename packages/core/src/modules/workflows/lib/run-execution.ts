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

/**
 * Events that RESOLVE a park. A step can park more than once in a run (a loop,
 * a retry, a rerun-from-step), so evidence is cleared as soon as the thing it
 * described came back — otherwise a step that waited for a signal on its first
 * pass keeps claiming to wait for it on its second.
 */
const WAIT_RESOLVED_EVENT_TYPES = new Set([
  'ACTIVITY_COMPLETED',
  'ACTIVITY_FAILED',
  'SIGNAL_RECEIVED',
  'TIMER_FIRED',
  'CONDITION_MET',
  'CONDITION_TIMED_OUT',
  'USER_TASK_COMPLETED',
  'PARALLEL_JOIN_COMPLETED',
])

const BRANCH_SETTLED_EVENT_TYPES = new Set([
  'PARALLEL_BRANCH_COMPLETED',
  'PARALLEL_BRANCH_FAILED',
  'PARALLEL_BRANCH_CANCELLED',
])

export type RunEventInput = {
  eventType: string
  eventData?: Record<string, unknown> | null
  occurredAt: string | Date
  /**
   * The engine stamps every step-scoped event with the `StepInstance` row it
   * belongs to, but only some of them repeat the definition `stepId` inside
   * `eventData`. Carrying the id here is what lets the park events
   * (`SIGNAL_AWAITING`, `TIMER_AWAITING`, `USER_TASK_CREATED`, …) be attributed
   * to a step at all — they name the row, never the step.
   */
  stepInstanceId?: string | null
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

/**
 * What a non-terminal step is doing or waiting for, read off the events the
 * engine ALREADY writes when it parks (spec §Part 2). Nothing here is a new
 * column and nothing here is a new event: `SIGNAL_AWAITING`, `TIMER_AWAITING`,
 * `CONDITION_AWAITING`, `USER_TASK_CREATED`, `ACTIVITY_QUEUED` and
 * `PARALLEL_FORK_OPENED` are all durable rows today.
 *
 * `StepInstance.outputData` — which carries the same facts on the return value
 * of `enterStep` — is deliberately NOT read: `exitStep` writes it on the
 * COMPLETED path only, so on a parked step it is null. The events are the only
 * place the park survives.
 */
export type StepWaitEvidence =
  | { kind: 'asyncActivity'; activityName: string | null }
  /**
   * The agent job is on the dedicated `workflow-invoke-agent` queue and the step
   * is parked on the proposal-ready signal WAITING FOR THE AGENT ITSELF.
   * `INVOKE_AGENT` is not async-capable in the registry's sense
   * (`async: { capable: false, reason: 'parksOnDedicatedQueue' }`), so it never
   * logs `ACTIVITY_QUEUED` — the park event is the only trace, and its absence
   * of a `proposalId` is what says the agent has not answered yet.
   */
  | { kind: 'agentRunning'; agentId: string | null }
  /**
   * The agent answered and its proposal was routed to a human.
   * `lib/agent-disposition-task.ts` writes a real `UserTask` and logs
   * `USER_TASK_CREATED` carrying the `proposalId` against the SAME step
   * instance — which is the only durable thing that distinguishes "the agent is
   * still running" from "a person has not decided yet". The invoke-agent
   * worker's own `user_task` branch logs nothing.
   */
  | { kind: 'agentDisposition'; proposalId: string | null }
  | { kind: 'subWorkflow'; childInstanceId: string | null }
  | { kind: 'signal'; signalName: string | null }
  | { kind: 'timer'; fireAt: Date | null }
  | { kind: 'condition'; deadlineAt: Date | null }
  | {
      kind: 'userTask'
      /**
       * The authored ROLE QUEUE, which is definition data every viewer of the
       * run already sees on the canvas. The individual assignee is deliberately
       * absent — see `hasAssignee`.
       */
      roleQueue: string | null
      /**
       * Whether an individual was resolved. The id itself is NOT carried: the
       * §6.4 visibility model decides who may see a task's owner, and this line
       * must not become a way around it. The run APIs expose an opaque user id
       * and no display name, so there is nothing honest to render either way.
       */
      hasAssignee: boolean
    }
  | { kind: 'fork'; branchTotal: number; branchesSettled: number }

/**
 * The engine-owned `metadata.attention` marker (the `failureQueue` directive
 * and the agent-review breach escalation both write it). Instance-level, so it
 * describes the step the run is parked on.
 */
export type RunAttention = { reason: string | null }

export type RunExecution = {
  stepStates: Map<string, StepRunState>
  routes: TakenRoute[]
  takenTransitionIds: Set<string>
  /** `from->to` pairs, so a route whose transition id was never recorded still paints. */
  takenStepPairs: Set<string>
  /**
   * Carried on the overlay so `resolveNodeRunStatus` can answer the START/END
   * conventions without every caller having to remember to pass them. A caller
   * that forgets is not obviously wrong — it just silently paints the END node
   * as never-reached on a completed run.
   */
  currentStepId: string | null
  instanceStatus: string | null
  /** Per-step park evidence, keyed by definition `stepId`. */
  waits: Map<string, StepWaitEvidence>
  attention: RunAttention | null
}

export type RunExecutionInput = {
  events?: readonly RunEventInput[]
  stepInstances?: readonly RunStepInstanceInput[]
  currentStepId?: string | null
  instanceStatus?: string | null
  /** `instance.metadata.attention` verbatim; anything unshaped is ignored. */
  attention?: unknown
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

function readBooleanish(data: Record<string, unknown> | null | undefined, key: string): boolean {
  const value = data?.[key]
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' ? value.length > 0 : Boolean(value)
}

function readRoleQueue(data: Record<string, unknown> | null | undefined): string | null {
  const value = data?.assignedToRoles
  if (Array.isArray(value)) {
    const named = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    return named.length > 0 ? named.join(', ') : null
  }
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Turn one park event into evidence. Returns `null` for anything that is not a
 * park, so the caller can leave whatever it already had in place.
 */
function waitEvidenceFromEvent(event: RunEventInput): StepWaitEvidence | null {
  const data = event.eventData ?? null
  switch (event.eventType) {
    case 'ACTIVITY_QUEUED':
      return {
        kind: 'asyncActivity',
        activityName: readStringField(data, 'activityName') ?? readStringField(data, 'activityType'),
      }
    case 'SIGNAL_AWAITING': {
      // One event type, three genuinely different situations. The engine
      // distinguishes them with `reason` (INVOKE_AGENT / SUB_WORKFLOW) plus the
      // ids it carries, and the presentation states differ, so they cannot be
      // collapsed into "waiting for a signal".
      const reason = readStringField(data, 'reason')
      const childInstanceId = readStringField(data, 'childInstanceId')
      if (reason === 'SUB_WORKFLOW' || childInstanceId) {
        return { kind: 'subWorkflow', childInstanceId }
      }
      const proposalId = readStringField(data, 'proposalId')
      if (reason === 'INVOKE_AGENT') {
        // A `proposalId` at park time means the agent already ran inline (the
        // parallel-branch fallback path); its absence — the instance-level path —
        // means the job was only just enqueued.
        return proposalId
          ? { kind: 'agentDisposition', proposalId }
          : { kind: 'agentRunning', agentId: readStringField(data, 'agentId') }
      }
      return { kind: 'signal', signalName: readStringField(data, 'signalName') }
    }
    case 'TIMER_AWAITING':
      return { kind: 'timer', fireAt: toDate(readStringField(data, 'fireAt')) }
    case 'CONDITION_AWAITING':
      return { kind: 'condition', deadlineAt: toDate(readStringField(data, 'deadlineAt')) }
    case 'USER_TASK_CREATED': {
      // The agent-disposition review is a REAL user task, so it arrives here —
      // and its `proposalId` is what tells the two apart.
      const proposalId = readStringField(data, 'proposalId')
      if (proposalId) return { kind: 'agentDisposition', proposalId }
      return {
        kind: 'userTask',
        roleQueue: readRoleQueue(data),
        hasAssignee: readBooleanish(data, 'assignedTo'),
      }
    }
    default:
      return null
  }
}

/**
 * Fork progress is a TALLY over events, not a read of `WorkflowBranchInstance`:
 * the branch rows have no read surface, but `PARALLEL_FORK_OPENED` names every
 * branch key and each branch logs its own settle event. Counting them answers
 * "n of m branches still running" from evidence that is already durable.
 */
type ForkTally = { stepId: string; branchKeys: Set<string>; settled: Set<string> }

export function deriveRunExecution(input: RunExecutionInput): RunExecution {
  const stepStates = new Map<string, StepRunState>()
  const routes: TakenRoute[] = []
  const takenTransitionIds = new Set<string>()
  const takenStepPairs = new Set<string>()
  const waits = new Map<string, StepWaitEvidence>()
  const stepIdByStepInstanceId = new Map<string, string>()
  let forkTally: ForkTally | null = null
  // Steps whose LATEST attempt only "completed" by advancing down an error /
  // guardrailBlocked outcome route (§7.2) or a §5.9 error route. The engine
  // records such a step as COMPLETED (it advanced), but its agent/activity did
  // not succeed — so the run view must not paint it a green "done". Re-entry
  // clears the flag, so a successful re-run (retry) shows green again.
  const erroredRoutedSteps = new Set<string>()

  for (const stepInstance of input.stepInstances ?? []) {
    if (stepInstance.id) stepIdByStepInstanceId.set(stepInstance.id, stepInstance.stepId)
  }

  // Events come back newest-first from the API; replay them oldest-first so a
  // later terminal event wins over an earlier entry for the same step.
  const orderedEvents = [...(input.events ?? [])].sort((left, right) => {
    const leftAt = toDate(left.occurredAt)?.getTime() ?? 0
    const rightAt = toDate(right.occurredAt)?.getTime() ?? 0
    return leftAt - rightAt
  })

  for (const event of orderedEvents) {
    applyEvent(stepStates, event)

    const eventStepId =
      readStringField(event.eventData, 'stepId')
      ?? (event.stepInstanceId ? stepIdByStepInstanceId.get(event.stepInstanceId) ?? null : null)

    if (eventStepId) {
      // A re-entry starts a fresh attempt, so anything the previous one parked
      // on no longer describes this step.
      if (STEP_ENTERED_EVENT_TYPES.has(event.eventType) || WAIT_RESOLVED_EVENT_TYPES.has(event.eventType)) {
        waits.delete(eventStepId)
      }
      const evidence = waitEvidenceFromEvent(event)
      if (evidence) waits.set(eventStepId, evidence)
    }

    // Track error/guardrailBlocked routing so a routed-but-failed step is not
    // painted as a clean completion below. A fresh attempt (STEP_ENTERED) clears
    // it, so only the latest attempt's outcome counts.
    if (eventStepId && STEP_ENTERED_EVENT_TYPES.has(event.eventType)) {
      erroredRoutedSteps.delete(eventStepId)
    } else if (event.eventType === 'OUTCOME_ROUTED') {
      const outcome = readStringField(event.eventData, 'outcome')
      const routedStepId = readStringField(event.eventData, 'stepId')
      if (routedStepId && (outcome === 'error' || outcome === 'guardrailBlocked')) {
        erroredRoutedSteps.add(routedStepId)
      }
    } else if (event.eventType === 'ERROR_ROUTED') {
      const failedStepId = readStringField(event.eventData, 'failedStepId')
      if (failedStepId) erroredRoutedSteps.add(failedStepId)
    }

    if (event.eventType === 'PARALLEL_FORK_OPENED') {
      const forkStepId = readStringField(event.eventData, 'forkStepId')
      const branchKeys = event.eventData?.branchKeys
      if (forkStepId && Array.isArray(branchKeys)) {
        forkTally = {
          stepId: forkStepId,
          branchKeys: new Set(branchKeys.filter((key): key is string => typeof key === 'string')),
          settled: new Set<string>(),
        }
      }
    } else if (BRANCH_SETTLED_EVENT_TYPES.has(event.eventType) && forkTally) {
      const branchKey = readStringField(event.eventData, 'branchKey')
      if (branchKey && forkTally.branchKeys.has(branchKey)) forkTally.settled.add(branchKey)
    } else if (event.eventType === 'PARALLEL_JOIN_COMPLETED' && forkTally) {
      waits.delete(forkTally.stepId)
      forkTally = null
    }

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

  // A step whose latest attempt exited only by routing an error/guardrailBlocked
  // outcome (or a §5.9 error route) is recorded COMPLETED by the engine, but its
  // work failed — repaint it errored so the run view never shows a green "done"
  // for a step whose agent/activity failed. Runs AFTER the authoritative pass;
  // only flips a currently-completed step (a live/failed one already tells the
  // truth), and a successful re-run cleared the flag so it stays green.
  for (const stepId of erroredRoutedSteps) {
    const existing = stepStates.get(stepId)
    if (existing && existing.status === 'completed') {
      stepStates.set(stepId, { ...existing, status: 'failed' })
    }
  }

  applyLiveInstanceStatus(stepStates, input.currentStepId, input.instanceStatus)

  if (forkTally && forkTally.branchKeys.size > forkTally.settled.size) {
    waits.set(forkTally.stepId, {
      kind: 'fork',
      branchTotal: forkTally.branchKeys.size,
      branchesSettled: forkTally.settled.size,
    })
  }

  return {
    stepStates,
    routes,
    takenTransitionIds,
    takenStepPairs,
    currentStepId: input.currentStepId ?? null,
    instanceStatus: input.instanceStatus ?? null,
    waits,
    attention: readAttention(input.attention),
  }
}

function readAttention(value: unknown): RunAttention | null {
  if (!value || typeof value !== 'object') return null
  const reason = (value as Record<string, unknown>).reason
  return { reason: typeof reason === 'string' && reason.length > 0 ? reason : null }
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

  const currentStepId = options.currentStepId ?? execution.currentStepId
  const instanceStatus = options.instanceStatus ?? execution.instanceStatus
  const isCurrentStep = currentStepId === node.id
  if (node.type === 'start') {
    return isCurrentStep ? 'active' : 'completed'
  }
  if (node.type === 'end') {
    return isCurrentStep || instanceStatus === 'COMPLETED' ? 'completed' : 'pending'
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
