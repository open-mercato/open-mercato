/**
 * Step presentation model (spec `2026-07-30-workflow-run-outcomes.md`, Part 2) — PURE.
 *
 * The canvas used to paint the ENGINE's lifecycle vocabulary, which was built
 * for control flow rather than for reading. `WAITING_FOR_ACTIVITIES` means "the
 * executor handed work to a queue and will resume when it returns" — that is the
 * engine WORKING, and painting it as an amber pause was the single most
 * misleading thing on the run views.
 *
 * The rule this module encodes: **amber means blocked on the outside world. If
 * the system is doing work it is blue and it moves.**
 *
 * Derived, never stored. No new column, no new engine event: every input is
 * either a `StepInstance` row, a `WorkflowEvent` row, the instance status or the
 * engine-owned `metadata.attention` marker. `lib/run-execution.ts` collects the
 * evidence; this decides what it MEANS. No React, no ORM, no DI — the same rule
 * `lib/node-outcome-rows.ts` and `lib/breach-routing.ts` follow.
 */

import type { RunExecution, StepWaitEvidence } from './run-execution'
import type { WorkflowStatus } from './status-colors'

export type StepPresentationState =
  /** The system is doing something right now. Blue, and it moves. */
  | 'working'
  /** Blocked on something OUTSIDE the system: a person, a timer, a signal. */
  | 'waiting'
  /** Parked in the failure queue or breached. Needs a human, unusually. */
  | 'attention'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'not_started'

/**
 * A translation descriptor rather than a string: this module is pure and has no
 * `useT`, and the caller is the only one that knows the viewer's locale.
 */
export type StepReason = {
  key: string
  fallback: string
  params?: Record<string, string | number>
}

export type StepPresentation = {
  state: StepPresentationState
  /** One line saying what the step is doing or waiting for. */
  reason: StepReason | null
  /**
   * When the CURRENT attempt began, so a working step can say "running for 4m".
   * `StepInstance.startedAt` already carries it, hence the spec's "it is free".
   */
  startedAt: Date | null
  /** Whether this state deserves motion. Motion is still gated on `prefers-reduced-motion`. */
  animated: boolean
}

/**
 * Instance statuses in which the ENGINE is working, whatever the step row says.
 *
 * - `WAITING_FOR_ACTIVITIES` — an async activity is executing in a worker.
 * - `FORKED` — `openFork` wrote the branch rows and `advanceBranches` drives
 *   them on the executor loop's next iteration. `FORK` is the one `waitReason`
 *   the engine itself does not treat as a park (`lib/transition-handler.ts`
 *   excludes it from `stepPaused`), and it is not an external park here either.
 * - `COMPENSATING` — the saga is unwinding, which is work.
 */
const WORKING_INSTANCE_STATUSES = new Set(['WAITING_FOR_ACTIVITIES', 'FORKED', 'COMPENSATING'])

const TERMINAL_STEP_STATUSES = new Set(['completed', 'failed', 'skipped'])

export type StepPresentationOptions = {
  /**
   * Agent id → author-facing label, from the OPTIONAL `agent_orchestrator`
   * peer's registry. Use the agent's LABEL, never its definition key — an
   * existing rule in this module. Absent (peer not installed, request failed)
   * degrades to the id rather than inventing a name.
   */
  agentLabels?: ReadonlyMap<string, string>
  /** The `INVOKE_AGENT` activity's configured agent id, read off the node. */
  agentId?: string | null
  /** Child-workflow label for the sub-workflow line, when the caller knows one. */
  childWorkflowLabel?: string | null
}

function agentName(
  agentId: string | null | undefined,
  options: StepPresentationOptions,
): string | null {
  const id = agentId ?? options.agentId ?? null
  if (!id) return null
  return options.agentLabels?.get(id) ?? id
}

function reasonFromEvidence(
  evidence: StepWaitEvidence,
  options: StepPresentationOptions,
): { state: StepPresentationState; reason: StepReason } {
  switch (evidence.kind) {
    case 'asyncActivity':
      return {
        state: 'working',
        reason: evidence.activityName
          ? { key: 'workflows.runState.reason.activityRunning', fallback: 'Running {activity}…', params: { activity: evidence.activityName } }
          : { key: 'workflows.runState.reason.activityRunningUnnamed', fallback: 'Running an activity…' },
      }
    case 'agentRunning': {
      // THE reported bug: an agent executing in its own worker is the system
      // working, and it used to paint the same amber pause as a task nobody has
      // opened since Tuesday.
      const agent = agentName(evidence.agentId, options)
      return {
        state: 'working',
        reason: agent
          ? { key: 'workflows.runState.reason.agentRunning', fallback: 'Agent {agent} is running…', params: { agent } }
          : { key: 'workflows.runState.reason.agentRunningUnnamed', fallback: 'An agent is running…' },
      }
    }
    case 'agentDisposition':
      return {
        state: 'waiting',
        reason: { key: 'workflows.runState.reason.agentDisposition', fallback: 'Waiting for a decision on the proposal' },
      }
    case 'subWorkflow': {
      // A running child IS the system working (spec's Working row), even though
      // the line says what it is waiting on.
      const child = options.childWorkflowLabel ?? evidence.childInstanceId
      return {
        state: 'working',
        reason: child
          ? { key: 'workflows.runState.reason.subWorkflow', fallback: 'Waiting for {workflow}', params: { workflow: child } }
          : { key: 'workflows.runState.reason.subWorkflowUnnamed', fallback: 'Waiting for a child workflow' },
      }
    }
    case 'signal':
      return {
        state: 'waiting',
        reason: evidence.signalName
          ? { key: 'workflows.runState.reason.signal', fallback: 'Waiting for signal {signal}', params: { signal: evidence.signalName } }
          : { key: 'workflows.runState.reason.signalUnnamed', fallback: 'Waiting for a signal' },
      }
    case 'timer':
      return {
        state: 'waiting',
        reason: evidence.fireAt
          ? { key: 'workflows.runState.reason.timer', fallback: 'Waiting until {time}', params: { time: evidence.fireAt.toLocaleString() } }
          : { key: 'workflows.runState.reason.timerUnnamed', fallback: 'Waiting for a timer' },
      }
    case 'condition':
      return {
        state: 'waiting',
        reason: evidence.deadlineAt
          ? { key: 'workflows.runState.reason.conditionUntil', fallback: 'Waiting for a condition, until {time}', params: { time: evidence.deadlineAt.toLocaleString() } }
          : { key: 'workflows.runState.reason.condition', fallback: 'Waiting for a condition' },
      }
    case 'userTask':
      // The role queue is definition data every viewer of the run already reads
      // off the canvas. An individual assignee is NEVER named here: §6.4 owns
      // that decision, and the run APIs expose an opaque user id with no display
      // name, so there is nothing honest to render anyway.
      return {
        state: 'waiting',
        reason: evidence.roleQueue
          ? { key: 'workflows.runState.reason.userTaskQueue', fallback: 'Waiting for {queue}', params: { queue: evidence.roleQueue } }
          : evidence.hasAssignee
            ? { key: 'workflows.runState.reason.userTaskAssignee', fallback: 'Waiting for the assignee' }
            : { key: 'workflows.runState.reason.userTask', fallback: 'Waiting for a person' },
      }
    case 'fork': {
      const running = Math.max(evidence.branchTotal - evidence.branchesSettled, 0)
      return {
        state: 'working',
        reason: {
          key: 'workflows.runState.reason.fork',
          fallback: '{running} of {total} branches still running',
          params: { running, total: evidence.branchTotal },
        },
      }
    }
  }
}

/**
 * Resolve the presentation for one node of the run graph.
 *
 * `status` is the already-resolved `StepRunStatus` for the node (from
 * `resolveNodeRunStatus`), which keeps the START/END conventions in one place.
 */
export function resolveStepPresentation(
  execution: RunExecution,
  node: { id: string; status: string },
  options: StepPresentationOptions = {},
): StepPresentation {
  const state = execution.stepStates.get(node.id) ?? null
  const startedAt = state?.startedAt ?? null

  if (TERMINAL_STEP_STATUSES.has(node.status)) {
    return { state: node.status as StepPresentationState, reason: null, startedAt, animated: false }
  }
  if (node.status === 'pending') {
    return { state: 'not_started', reason: null, startedAt: null, animated: false }
  }

  const isCurrentStep = execution.currentStepId === node.id

  // Attention outranks everything non-terminal: it is the one state that says
  // "a human is needed, and not in the ordinary way".
  if (execution.attention && isCurrentStep) {
    return {
      state: 'attention',
      reason: { key: 'workflows.runState.reason.attention', fallback: 'Parked for attention' },
      startedAt,
      animated: false,
    }
  }

  const evidence = execution.waits.get(node.id)
  if (evidence) {
    const resolved = reasonFromEvidence(evidence, options)
    return {
      state: resolved.state,
      reason: resolved.reason,
      startedAt,
      animated: resolved.state === 'working',
    }
  }

  // No park evidence, so the instance status is the next-best witness. A queue
  // hand-off, a fork or a compensation pass are the engine WORKING; anything
  // else that parked the step is a wait we simply cannot name, and saying
  // nothing is better than guessing a reason.
  const instanceStatus = execution.instanceStatus ?? null
  if (instanceStatus && WORKING_INSTANCE_STATUSES.has(instanceStatus)) {
    return { state: 'working', reason: null, startedAt, animated: true }
  }
  // `node.status === 'paused'` is `applyLiveInstanceStatus` reporting that the
  // engine parked THIS step. Without evidence there is nothing to name, but the
  // park itself is real, so it is amber rather than optimistically blue.
  if (node.status === 'paused') {
    return { state: 'waiting', reason: null, startedAt, animated: false }
  }
  return { state: 'working', reason: null, startedAt, animated: true }
}

/**
 * Map a presentation state onto the canvas paint vocabulary. Kept separate from
 * the resolver so the decision stays testable without a colour table, and so a
 * surface that paints differently (a list badge, a timeline bar) can reuse the
 * same states.
 */
export function presentationToWorkflowStatus(state: StepPresentationState): WorkflowStatus {
  switch (state) {
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'attention':
      return 'needs_attention'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    // Deliberately unchanged: `toWorkflowStatus` has always painted a skipped
    // step as the resting state, and repainting it belongs to Part 1's verdict
    // work, not to the working-vs-waiting split.
    case 'skipped':
      return 'not_started'
    case 'not_started':
      return 'not_started'
  }
}
