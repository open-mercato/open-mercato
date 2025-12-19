/**
 * Workflows Module - Event Logger Service
 *
 * Consolidates workflow event logging for audit trail and replay:
 * - Log workflow lifecycle events
 * - Log step execution events
 * - Log transition events
 * - Query event history
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager } from '@mikro-orm/core'
import { WorkflowEvent } from '../data/entities'

// ============================================================================
// Event Type Constants
// ============================================================================

export const WorkflowEventTypes = {
  // Workflow lifecycle
  WORKFLOW_STARTED: 'WORKFLOW_STARTED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED: 'WORKFLOW_FAILED',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',
  WORKFLOW_PAUSED: 'WORKFLOW_PAUSED',
  WORKFLOW_RESUMED: 'WORKFLOW_RESUMED',

  // Step lifecycle
  STEP_ENTERED: 'STEP_ENTERED',
  STEP_EXITED: 'STEP_EXITED',
  STEP_FAILED: 'STEP_FAILED',
  STEP_SKIPPED: 'STEP_SKIPPED',

  // Transition events
  TRANSITION_EXECUTED: 'TRANSITION_EXECUTED',
  TRANSITION_REJECTED: 'TRANSITION_REJECTED',
  TRANSITION_POST_CONDITION_FAILED: 'TRANSITION_POST_CONDITION_FAILED',
  TRANSITION_FAILED: 'TRANSITION_FAILED',

  // Activity events
  ACTIVITY_SCHEDULED: 'ACTIVITY_SCHEDULED',
  ACTIVITY_STARTED: 'ACTIVITY_STARTED',
  ACTIVITY_COMPLETED: 'ACTIVITY_COMPLETED',
  ACTIVITY_FAILED: 'ACTIVITY_FAILED',
  ACTIVITY_RETRY: 'ACTIVITY_RETRY',

  // User task events
  USER_TASK_CREATED: 'USER_TASK_CREATED',
  USER_TASK_ASSIGNED: 'USER_TASK_ASSIGNED',
  USER_TASK_STARTED: 'USER_TASK_STARTED',
  USER_TASK_COMPLETED: 'USER_TASK_COMPLETED',
  USER_TASK_CANCELLED: 'USER_TASK_CANCELLED',
  USER_TASK_ESCALATED: 'USER_TASK_ESCALATED',

  // Compensation events (Phase 8)
  COMPENSATION_STARTED: 'COMPENSATION_STARTED',
  COMPENSATION_COMPLETED: 'COMPENSATION_COMPLETED',
  COMPENSATION_FAILED: 'COMPENSATION_FAILED',

  // Signal events (Phase 9)
  SIGNAL_RECEIVED: 'SIGNAL_RECEIVED',
  SIGNAL_TIMEOUT: 'SIGNAL_TIMEOUT',

  // Timer events (Phase 9)
  TIMER_FIRED: 'TIMER_FIRED',
  TIMER_CANCELLED: 'TIMER_CANCELLED',
} as const

export type WorkflowEventType = typeof WorkflowEventTypes[keyof typeof WorkflowEventTypes]

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface WorkflowEventInput {
  workflowInstanceId: string
  stepInstanceId?: string
  eventType: WorkflowEventType | string
  eventData: any
  userId?: string
  tenantId: string
  organizationId: string
}

export interface QueryOptions {
  eventTypes?: Array<WorkflowEventType | string>
  stepInstanceId?: string
  fromDate?: Date
  toDate?: Date
  limit?: number
  offset?: number
}

export interface EventStatistics {
  totalEvents: number
  eventsByType: Record<string, number>
  firstEvent?: Date
  lastEvent?: Date
}

// ============================================================================
// Main Event Logging Functions
// ============================================================================

/**
 * Log a workflow event to the event sourcing table
 *
 * @param em - Entity manager
 * @param event - Event input data
 * @returns Created event entity
 */
export async function logWorkflowEvent(
  em: EntityManager,
  event: WorkflowEventInput
): Promise<WorkflowEvent> {
  const workflowEvent = em.create(WorkflowEvent, {
    workflowInstanceId: event.workflowInstanceId,
    stepInstanceId: event.stepInstanceId || null,
    eventType: event.eventType,
    eventData: event.eventData || {},
    userId: event.userId || null,
    tenantId: event.tenantId,
    organizationId: event.organizationId,
    occurredAt: new Date(),
  })

  await em.persistAndFlush(workflowEvent)

  return workflowEvent
}

/**
 * Log multiple workflow events in batch
 *
 * @param em - Entity manager
 * @param events - Array of event input data
 * @returns Array of created event entities
 */
export async function logWorkflowEvents(
  em: EntityManager,
  events: WorkflowEventInput[]
): Promise<WorkflowEvent[]> {
  const workflowEvents = events.map(event =>
    em.create(WorkflowEvent, {
      workflowInstanceId: event.workflowInstanceId,
      stepInstanceId: event.stepInstanceId || null,
      eventType: event.eventType,
      eventData: event.eventData || {},
      userId: event.userId || null,
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      occurredAt: new Date(),
    })
  )

  await em.persistAndFlush(workflowEvents)

  return workflowEvents
}

// ============================================================================
// Event Query Functions
// ============================================================================

/**
 * Get all events for a workflow instance
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @param options - Query options (filters, pagination)
 * @returns Array of workflow events
 */
export async function getWorkflowEvents(
  em: EntityManager,
  instanceId: string,
  options?: QueryOptions
): Promise<WorkflowEvent[]> {
  const where: any = {
    workflowInstanceId: instanceId,
  }

  // Filter by event types
  if (options?.eventTypes && options.eventTypes.length > 0) {
    where.eventType = { $in: options.eventTypes }
  }

  // Filter by step instance
  if (options?.stepInstanceId) {
    where.stepInstanceId = options.stepInstanceId
  }

  // Filter by date range
  if (options?.fromDate || options?.toDate) {
    where.occurredAt = {}
    if (options.fromDate) {
      where.occurredAt.$gte = options.fromDate
    }
    if (options.toDate) {
      where.occurredAt.$lte = options.toDate
    }
  }

  const events = await em.find(
    WorkflowEvent,
    where,
    {
      orderBy: { occurredAt: 'ASC' },
      limit: options?.limit,
      offset: options?.offset,
    }
  )

  return events
}

/**
 * Get events for a specific step instance
 *
 * @param em - Entity manager
 * @param stepInstanceId - Step instance ID
 * @returns Array of workflow events
 */
export async function getStepEvents(
  em: EntityManager,
  stepInstanceId: string
): Promise<WorkflowEvent[]> {
  const events = await em.find(
    WorkflowEvent,
    { stepInstanceId },
    { orderBy: { occurredAt: 'ASC' } }
  )

  return events
}

/**
 * Get the latest event for a workflow instance
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @param eventType - Optional event type filter
 * @returns Latest workflow event or null
 */
export async function getLatestEvent(
  em: EntityManager,
  instanceId: string,
  eventType?: WorkflowEventType | string
): Promise<WorkflowEvent | null> {
  const where: any = {
    workflowInstanceId: instanceId,
  }

  if (eventType) {
    where.eventType = eventType
  }

  const event = await em.findOne(
    WorkflowEvent,
    where,
    { orderBy: { occurredAt: 'DESC' } }
  )

  return event
}

/**
 * Count events for a workflow instance
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @param eventType - Optional event type filter
 * @returns Count of events
 */
export async function countEvents(
  em: EntityManager,
  instanceId: string,
  eventType?: WorkflowEventType | string
): Promise<number> {
  const where: any = {
    workflowInstanceId: instanceId,
  }

  if (eventType) {
    where.eventType = eventType
  }

  return await em.count(WorkflowEvent, where)
}

/**
 * Get event statistics for a workflow instance
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @returns Event statistics
 */
export async function getEventStatistics(
  em: EntityManager,
  instanceId: string
): Promise<EventStatistics> {
  const events = await em.find(
    WorkflowEvent,
    { workflowInstanceId: instanceId },
    { orderBy: { occurredAt: 'ASC' } }
  )

  const eventsByType: Record<string, number> = {}

  for (const event of events) {
    eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1
  }

  return {
    totalEvents: events.length,
    eventsByType,
    firstEvent: events.length > 0 ? events[0].occurredAt : undefined,
    lastEvent: events.length > 0 ? events[events.length - 1].occurredAt : undefined,
  }
}

/**
 * Check if a specific event type has occurred for a workflow instance
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @param eventType - Event type to check
 * @returns True if event has occurred
 */
export async function hasEventOccurred(
  em: EntityManager,
  instanceId: string,
  eventType: WorkflowEventType | string
): Promise<boolean> {
  const count = await em.count(WorkflowEvent, {
    workflowInstanceId: instanceId,
    eventType,
  })

  return count > 0
}

/**
 * Get event timeline for a workflow instance (simplified view)
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @returns Array of simplified event objects
 */
export async function getEventTimeline(
  em: EntityManager,
  instanceId: string
): Promise<Array<{
  eventType: string
  occurredAt: Date
  stepInstanceId?: string
  userId?: string
  summary: string
}>> {
  const events = await em.find(
    WorkflowEvent,
    { workflowInstanceId: instanceId },
    { orderBy: { occurredAt: 'ASC' } }
  )

  return events.map(event => ({
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    stepInstanceId: event.stepInstanceId || undefined,
    userId: event.userId || undefined,
    summary: generateEventSummary(event),
  }))
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate human-readable summary for an event
 */
function generateEventSummary(event: WorkflowEvent): string {
  const data = event.eventData || {}

  switch (event.eventType) {
    case WorkflowEventTypes.WORKFLOW_STARTED:
      return `Workflow started${data.workflowId ? ` (${data.workflowId})` : ''}`

    case WorkflowEventTypes.WORKFLOW_COMPLETED:
      return `Workflow completed${data.result ? ` with result` : ''}`

    case WorkflowEventTypes.WORKFLOW_FAILED:
      return `Workflow failed${data.error ? `: ${data.error}` : ''}`

    case WorkflowEventTypes.STEP_ENTERED:
      return `Entered step: ${data.stepName || data.stepId || 'unknown'}`

    case WorkflowEventTypes.STEP_EXITED:
      return `Exited step: ${data.stepName || data.stepId || 'unknown'}${
        data.executionTimeMs ? ` (${data.executionTimeMs}ms)` : ''
      }`

    case WorkflowEventTypes.STEP_FAILED:
      return `Step failed: ${data.stepName || data.stepId || 'unknown'}${
        data.error ? ` - ${data.error}` : ''
      }`

    case WorkflowEventTypes.TRANSITION_EXECUTED:
      return `Transition: ${data.fromStepId} → ${data.toStepId}`

    case WorkflowEventTypes.TRANSITION_REJECTED:
      return `Transition blocked: ${data.fromStepId} → ${data.toStepId}${
        data.reason ? ` (${data.reason})` : ''
      }`

    case WorkflowEventTypes.USER_TASK_CREATED:
      return `User task created: ${data.taskName || 'unnamed'}${
        data.assignedTo ? ` (assigned to ${data.assignedTo})` : ''
      }`

    case WorkflowEventTypes.USER_TASK_COMPLETED:
      return `User task completed: ${data.taskName || 'unnamed'}`

    case WorkflowEventTypes.ACTIVITY_COMPLETED:
      return `Activity completed: ${data.activityName || data.activityId || 'unknown'}`

    case WorkflowEventTypes.ACTIVITY_FAILED:
      return `Activity failed: ${data.activityName || data.activityId || 'unknown'}${
        data.error ? ` - ${data.error}` : ''
      }`

    default:
      return event.eventType
  }
}

/**
 * Validate event type is a known type
 */
export function isValidEventType(eventType: string): eventType is WorkflowEventType {
  return Object.values(WorkflowEventTypes).includes(eventType as WorkflowEventType)
}

/**
 * Get all known event types
 */
export function getAllEventTypes(): WorkflowEventType[] {
  return Object.values(WorkflowEventTypes)
}
