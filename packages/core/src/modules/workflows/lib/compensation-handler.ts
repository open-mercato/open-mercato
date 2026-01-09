import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance, WorkflowDefinition, WorkflowEvent } from '../data/entities'
import { executeActivity } from './activity-executor'
import { logWorkflowEvent } from './event-logger'

/**
 * Compensation Handler - Implements Saga pattern for workflow rollback
 *
 * When a workflow fails, this service executes compensation activities
 * in reverse order to undo changes made by completed activities.
 */

export interface CompensationOptions {
  /**
   * Maximum number of compensation activities to execute
   * Useful for partial compensation scenarios
   */
  maxCompensations?: number

  /**
   * Whether to continue compensating if a compensation activity fails
   * Default: true (continue with best effort)
   */
  continueOnError?: boolean

  /**
   * User ID initiating compensation
   */
  userId?: string
}

export interface CompensationResult {
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL'
  totalActivities: number
  compensatedActivities: number
  failedCompensations: string[]
  errors?: string[]
}

/**
 * Execute compensation for a failed workflow
 * Reverses completed activities in LIFO order
 */
export async function compensateWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  options: CompensationOptions = {}
): Promise<CompensationResult> {
  const {
    maxCompensations,
    continueOnError = true,
    userId
  } = options

  // Update workflow status to COMPENSATING
  instance.status = 'COMPENSATING'
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'COMPENSATION_STARTED',
    eventData: {
      reason: instance.errorMessage,
      maxCompensations,
      continueOnError
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId
  })

  // Get all ACTIVITY_COMPLETED events in reverse chronological order
  const completedActivities = await getCompletedActivitiesForCompensation(
    em,
    instance.id
  )

  // Limit compensation count if specified
  const activitiesToCompensate = maxCompensations
    ? completedActivities.slice(0, maxCompensations)
    : completedActivities

  const result: CompensationResult = {
    status: 'COMPLETED',
    totalActivities: completedActivities.length,
    compensatedActivities: 0,
    failedCompensations: [],
    errors: []
  }

  // Execute compensation activities in reverse order (LIFO)
  for (const event of activitiesToCompensate) {
    const activityId = event.eventData.activityId
    const activityName = event.eventData.activityName

    // Find activity definition
    const activityDef = findActivityInDefinition(definition, activityId)

    if (!activityDef) {
      console.warn(`Activity ${activityId} not found in definition, skipping compensation`)
      continue
    }

    // Check if activity has compensation defined
    if (!activityDef.compensation?.activityId) {
      console.log(`Activity ${activityId} has no compensation, skipping`)
      continue
    }

    // Find compensation activity definition
    const compensationActivityId = activityDef.compensation.activityId
    const compensationDef = findActivityInDefinition(definition, compensationActivityId)

    if (!compensationDef) {
      console.warn(`Compensation activity ${compensationActivityId} not found, skipping`)
      result.failedCompensations.push(activityId)
      continue
    }

    // Execute compensation activity
    try {
      await logWorkflowEvent(em, {
        workflowInstanceId: instance.id,
        eventType: 'COMPENSATION_ACTIVITY_STARTED',
        eventData: {
          originalActivityId: activityId,
          compensationActivityId,
          compensationActivityName: compensationDef.activityName
        },
        userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId
      })

      const compensationResult = await executeActivity(em, container, compensationDef, {
        workflowInstance: instance,
        workflowContext: instance.context,
        userId
      })

      if (compensationResult.success) {
        result.compensatedActivities++

        await logWorkflowEvent(em, {
          workflowInstanceId: instance.id,
          eventType: 'COMPENSATION_ACTIVITY_COMPLETED',
          eventData: {
            originalActivityId: activityId,
            compensationActivityId,
            output: compensationResult.output,
            executionTimeMs: compensationResult.executionTimeMs
          },
          userId,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId
        })
      } else {
        result.failedCompensations.push(activityId)
        result.errors?.push(`Failed to compensate ${activityName}: ${compensationResult.error}`)

        await logWorkflowEvent(em, {
          workflowInstanceId: instance.id,
          eventType: 'COMPENSATION_ACTIVITY_FAILED',
          eventData: {
            originalActivityId: activityId,
            compensationActivityId,
            error: compensationResult.error
          },
          userId,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId
        })

        if (!continueOnError) {
          result.status = 'FAILED'
          break
        }
      }
    } catch (error: any) {
      result.failedCompensations.push(activityId)
      result.errors?.push(`Exception compensating ${activityName}: ${error.message}`)

      await logWorkflowEvent(em, {
        workflowInstanceId: instance.id,
        eventType: 'COMPENSATION_ACTIVITY_FAILED',
        eventData: {
          originalActivityId: activityId,
          compensationActivityId,
          error: error.message
        },
        userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId
      })

      if (!continueOnError) {
        result.status = 'FAILED'
        break
      }
    }
  }

  // Determine final status
  if (result.failedCompensations.length > 0) {
    result.status = result.compensatedActivities > 0 ? 'PARTIAL' : 'FAILED'
  }

  // Update workflow instance status
  instance.status = result.status === 'COMPLETED' ? 'COMPENSATED' : 'FAILED'
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: result.status === 'COMPLETED'
      ? 'COMPENSATION_COMPLETED'
      : result.status === 'PARTIAL'
      ? 'COMPENSATION_PARTIAL'
      : 'COMPENSATION_FAILED',
    eventData: {
      totalActivities: result.totalActivities,
      compensatedActivities: result.compensatedActivities,
      failedCompensations: result.failedCompensations,
      errors: result.errors
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId
  })

  return result
}

/**
 * Get completed activities that need compensation, in reverse order (LIFO)
 */
async function getCompletedActivitiesForCompensation(
  em: EntityManager,
  workflowInstanceId: string
): Promise<WorkflowEvent[]> {
  const events = await em.find(WorkflowEvent, {
    workflowInstanceId,
    eventType: 'ACTIVITY_COMPLETED'
  }, {
    orderBy: { occurredAt: 'DESC' } // Reverse chronological order
  })

  return events
}

/**
 * Find activity definition in workflow definition
 * Activities can be in transitions or at definition root (legacy)
 */
function findActivityInDefinition(
  definition: WorkflowDefinition,
  activityId: string
): any | undefined {
  // Check activities in transitions (new structure)
  for (const transition of definition.definition.transitions) {
    if (transition.activities) {
      const activity = transition.activities.find((a: any) => a.activityId === activityId)
      if (activity) return activity
    }
  }

  // Check root-level activities (legacy structure)
  if (definition.definition.activities) {
    return definition.definition.activities.find((a: any) => a.activityId === activityId)
  }

  return undefined
}

/**
 * Check if an activity should be compensated based on its configuration
 */
export function shouldCompensateActivity(activityDef: any): boolean {
  return !!(activityDef.compensation?.activityId)
}
