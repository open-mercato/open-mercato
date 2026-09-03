/**
 * Workflow Activity Queue Types
 *
 * Type definitions for async activity execution via queue system.
 * Jobs are discriminated by the optional `kind` field:
 *   - `'activity'` (default, back-compat): background execution of a workflow activity
 *   - `'timer'`: delayed fire-timer job for a WAIT_FOR_TIMER step
 *   - `'condition'`: delayed poll job for a WAIT_FOR_CONDITION step — the
 *     durability backstop behind the event-driven context-write wake
 *   - `'task_sla'`: delayed reminder / deadline-breach job for a USER_TASK,
 *     carrying the absolute deadline so the queue cannot extend it
 *   - `'invoke_agent'`: run an INVOKE_AGENT step's agent OUTSIDE the workflow
 *     transaction, then resume the parked step via the proposal-ready signal
 *   - `'workflow_error_handler'`: start the definition's catch-all handler
 *     sub-workflow for a failed instance, outside the failing transaction
 */

import type { AgentDispositionReview } from './agent-disposition-task'

export interface WorkflowActivityJobBase {
  workflowInstanceId: string
  stepInstanceId?: string
  // Set when the job belongs to a parallel branch; resume targets that branch.
  // Absent on jobs enqueued before parallel support shipped → instance-level resume.
  branchInstanceId?: string | null
  tenantId: string
  organizationId: string
  userId?: string
}

export interface WorkflowActivityJobActivity extends WorkflowActivityJobBase {
  kind?: 'activity'
  transitionId?: string

  activityId: string
  activityName: string
  activityType: string
  activityConfig: any

  workflowContext: Record<string, any>
  stepContext?: Record<string, any>

  retryPolicy?: {
    maxAttempts: number
    initialIntervalMs: number
    backoffCoefficient: number
    maxIntervalMs: number
  }
  timeoutMs?: number
}

export interface WorkflowActivityJobTimer extends WorkflowActivityJobBase {
  kind: 'timer'
  stepInstanceId: string
  fireAt: string // ISO 8601 timestamp for when the timer should fire
}

/**
 * Poll job for a WAIT_FOR_CONDITION step. `deadlineAt` is absolute and carried
 * on the payload rather than recomputed per tick, so a slow queue can never
 * silently extend the configured timeout. `attempt` is 1-based and guards
 * against a runaway re-enqueue loop (see OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS).
 */
export interface WorkflowActivityJobCondition extends WorkflowActivityJobBase {
  kind: 'condition'
  stepInstanceId: string
  deadlineAt: string
  attempt: number
}

/**
 * SLA job for a USER_TASK's deadline. One job per authored reminder offset plus
 * one for the deadline itself, all enqueued when the task is created.
 *
 * `deadlineAt` is ABSOLUTE and travels on the payload — exactly like the
 * WAIT_FOR_CONDITION backstop — so a queue that runs late can never silently
 * extend the deadline the author configured. `fireAt` records when this
 * particular job was meant to run, so a late reminder can recognise itself.
 *
 * Delivery is at-least-once: the handler is idempotent (a completed, cancelled
 * or already-breached task makes the job a no-op).
 */
export interface WorkflowActivityJobTaskSla extends WorkflowActivityJobBase {
  kind: 'task_sla'
  stepInstanceId: string
  userTaskId: string
  phase: 'reminder' | 'breach'
  deadlineAt: string
  fireAt: string
}

export interface WorkflowActivityJobInvokeAgent extends WorkflowActivityJobBase {
  kind: 'invoke_agent'
  stepInstanceId: string
  // The step (node) id the agent runs for; used to confirm the instance is still
  // parked on this step before running the agent (race + idempotency guard).
  stepId: string
  // Signal the parked step listens on; the worker fires it to resume after the
  // agent run (agent_orchestrator.proposal.ready).
  signalName: string
  agentId: string
  input: Record<string, any>
  onResult: { autoApproveThreshold: number } | { alwaysAsk: true }
  // Optional routing of the agent result into workflow context (see
  // invokeAgentConfigSchema.outputMapping). Threaded through so the worker that
  // resumes the parked step can build the same context patch the inline path does.
  outputMapping?: Record<string, string>
  // Optional already-interpolated business-record descriptor (see
  // invokeAgentConfigSchema.subject); forwarded opaquely to the bridge ctx.
  subject?: Record<string, any>
  // Optional already-RESOLVED Review section (see invokeAgentConfigSchema.review,
  // spec 7.5). Resolved by the executor against the context the step ran with,
  // so an in-flight definition edit cannot retro-change who the disposition task
  // belongs to. Absent on every job enqueued before the section existed.
  review?: AgentDispositionReview
}

/**
 * Resume-parent job enqueued by `completeWorkflow` when a child instance with a
 * parent linkage reaches a terminal state. The worker loads the parent, confirms
 * it is still parked on the SUB_WORKFLOW step, maps the child output, and resumes
 * (or fails) the parent. Idempotent: a child completed inline (synchronous fast
 * path) enqueues a job that the worker guard skips.
 */
export interface WorkflowActivityJobResumeSubWorkflowParent extends WorkflowActivityJobBase {
  kind: 'resume_subworkflow_parent'
  parentInstanceId: string
  parentStepId: string
  parentStepInstanceId: string
  childInstanceId: string
  childStatus: 'COMPLETED' | 'FAILED'
}

/**
 * Workflow-level error handler job (spec 5.9), enqueued by `completeWorkflow`
 * before compensation runs. The failure triple travels on the payload so the
 * handler observes the PRE-compensation state, and the worker starts it on its
 * own connection — never inside the failing instance's transaction.
 */
export interface WorkflowActivityJobErrorHandler extends WorkflowActivityJobBase {
  kind: 'workflow_error_handler'
  handlerWorkflowId: string
  handlerVersion?: number
  failedStepId: string | null
  error: string | null
  contextSnapshot: Record<string, unknown>
  // 1-based nesting level of the handler being started; capped by
  // WORKFLOW_MAX_ERROR_HANDLER_DEPTH so a failing handler never recurses.
  depth: number
}

export type WorkflowActivityJob =
  | WorkflowActivityJobActivity
  | WorkflowActivityJobTimer
  | WorkflowActivityJobCondition
  | WorkflowActivityJobTaskSla
  | WorkflowActivityJobInvokeAgent
  | WorkflowActivityJobResumeSubWorkflowParent
  | WorkflowActivityJobErrorHandler

export const WORKFLOW_ACTIVITIES_QUEUE_NAME = 'workflow-activities'

/**
 * Dedicated queue for `invoke_agent` jobs. Minute-long LLM runs must not share
 * execution slots with fast workflow activities (timers, emails, API calls), so
 * `executeInvokeAgent` enqueues here and the `workflow-invoke-agent` worker
 * consumes with its own concurrency (`WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY`).
 */
export const WORKFLOW_INVOKE_AGENT_QUEUE_NAME = 'workflow-invoke-agent'
