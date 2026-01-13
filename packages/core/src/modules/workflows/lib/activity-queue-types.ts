/**
 * Workflow Activity Queue Types
 *
 * Type definitions for async activity execution via queue system.
 */

export interface WorkflowActivityJob {
  // Execution context
  workflowInstanceId: string
  stepInstanceId?: string
  transitionId?: string

  // Activity definition
  activityId: string
  activityName: string
  activityType: string
  activityConfig: any

  // Workflow context (for execution)
  workflowContext: Record<string, any>
  stepContext?: Record<string, any>

  // Retry & timeout config
  retryPolicy?: {
    maxAttempts: number
    initialIntervalMs: number
    backoffCoefficient: number
    maxIntervalMs: number
  }
  timeoutMs?: number

  // Multi-tenant
  tenantId: string
  organizationId: string

  // Metadata
  userId?: string
}

export const WORKFLOW_ACTIVITIES_QUEUE_NAME = 'workflow-activities'
