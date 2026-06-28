/**
 * Workflow Activity Queue Types
 *
 * Type definitions for async activity execution via queue system.
 * Jobs are discriminated by the optional `kind` field:
 *   - `'activity'` (default, back-compat): background execution of a workflow activity
 *   - `'timer'`: delayed fire-timer job for a WAIT_FOR_TIMER step
 *   - `'invoke_agent'`: run an INVOKE_AGENT step's agent OUTSIDE the workflow
 *     transaction, then resume the parked step via the proposal-ready signal
 */

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
}

export type WorkflowActivityJob =
  | WorkflowActivityJobActivity
  | WorkflowActivityJobTimer
  | WorkflowActivityJobInvokeAgent

export const WORKFLOW_ACTIVITIES_QUEUE_NAME = 'workflow-activities'
