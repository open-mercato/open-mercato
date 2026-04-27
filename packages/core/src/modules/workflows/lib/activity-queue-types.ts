/**
 * Workflow Activity Queue Types
 *
 * Type definitions for async activity execution via queue system.
 * Jobs are discriminated by the optional `kind` field:
 *   - `'activity'` (default, back-compat): background execution of a workflow activity
 *   - `'timer'`: delayed fire-timer job for a WAIT_FOR_TIMER step
 */

export interface WorkflowActivityJobBase {
  workflowInstanceId: string
  stepInstanceId?: string
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

export type WorkflowActivityJob = WorkflowActivityJobActivity | WorkflowActivityJobTimer

export const WORKFLOW_ACTIVITIES_QUEUE_NAME = 'workflow-activities'
