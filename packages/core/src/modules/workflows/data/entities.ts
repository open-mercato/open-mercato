/**
 * Workflows Module - Database Entities
 *
 * MikroORM entities for workflow engine.
 */

import { Entity, PrimaryKey, Property, Index, Unique, OptionalProps } from '@mikro-orm/core'

// ============================================================================
// Type Definitions
// ============================================================================

export type WorkflowStepType =
  | 'START'
  | 'END'
  | 'USER_TASK'
  | 'AUTOMATED'
  | 'PARALLEL_FORK'
  | 'PARALLEL_JOIN'
  | 'SUB_WORKFLOW'
  | 'WAIT_FOR_SIGNAL'
  | 'WAIT_FOR_TIMER'

export type WorkflowInstanceStatus =
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'WAITING_FOR_ACTIVITIES'

export type StepInstanceStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'

export type UserTaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ESCALATED'

// ============================================================================
// JSONB Structure Interfaces
// ============================================================================

export interface WorkflowDefinitionData {
  steps: any[] // WorkflowStep[] - will define schema in validators.ts
  transitions: any[] // WorkflowTransition[] - will define schema in validators.ts
  activities?: any[] // ActivityDefinition[] - will define schema in validators.ts
  queries?: any[]
  signals?: any[]
  timers?: any[]
}

export interface WorkflowMetadata {
  tags?: string[]
  category?: string
  icon?: string
}

export interface WorkflowInstanceMetadata {
  entityType?: string
  entityId?: string
  initiatedBy?: string
  labels?: Record<string, string>
}

// ============================================================================
// Entity: WorkflowDefinition
// ============================================================================

/**
 * WorkflowDefinition entity
 *
 * Stores workflow definitions (templates) that can be instantiated
 * to create workflow instances.
 */
@Entity({ tableName: 'workflow_definitions' })
@Unique({ properties: ['workflowId', 'tenantId'] })
@Index({ name: 'workflow_definitions_enabled_idx', properties: ['enabled'] })
@Index({ name: 'workflow_definitions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'workflow_definitions_workflow_id_idx', properties: ['workflowId'] })
export class WorkflowDefinition {
  [OptionalProps]?: 'enabled' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string

  @Property({ name: 'workflow_name', type: 'varchar', length: 255 })
  workflowName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'version', type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'definition', type: 'jsonb' })
  definition!: WorkflowDefinitionData

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: WorkflowMetadata | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: WorkflowInstance
// ============================================================================

/**
 * WorkflowInstance entity
 *
 * Represents a running instance of a workflow definition.
 * Tracks the current state, context data, and execution status.
 */
@Entity({ tableName: 'workflow_instances' })
@Index({ name: 'workflow_instances_definition_status_idx', properties: ['definitionId', 'status'] })
@Index({ name: 'workflow_instances_correlation_key_idx', properties: ['correlationKey'] })
@Index({ name: 'workflow_instances_status_tenant_idx', properties: ['status', 'tenantId'] })
@Index({ name: 'workflow_instances_current_step_idx', properties: ['currentStepId', 'status'] })
@Index({ name: 'workflow_instances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowInstance {
  [OptionalProps]?: 'retryCount' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'definition_id', type: 'uuid' })
  definitionId!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string

  @Property({ name: 'version', type: 'integer' })
  version!: number

  @Property({ name: 'status', type: 'varchar', length: 30 })
  status!: WorkflowInstanceStatus

  @Property({ name: 'current_step_id', type: 'varchar', length: 100 })
  currentStepId!: string

  @Property({ name: 'context', type: 'jsonb' })
  context!: Record<string, any>

  @Property({ name: 'correlation_key', type: 'varchar', length: 255, nullable: true })
  correlationKey?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: WorkflowInstanceMetadata | null

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'paused_at', type: Date, nullable: true })
  pausedAt?: Date | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails?: any | null

  @Property({ name: 'pending_transition', type: 'jsonb', nullable: true })
  pendingTransition?: {
    toStepId: string
    activityResults: any[]
    timestamp: Date
  } | null

  @Property({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number = 0

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: StepInstance
// ============================================================================

/**
 * StepInstance entity
 *
 * Tracks individual step executions within a workflow instance.
 * Records input/output data, timing, and execution status for each step.
 */
@Entity({ tableName: 'step_instances' })
@Index({ name: 'step_instances_workflow_instance_idx', properties: ['workflowInstanceId', 'status'] })
@Index({ name: 'step_instances_step_id_idx', properties: ['stepId', 'status'] })
@Index({ name: 'step_instances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StepInstance {
  [OptionalProps]?: 'retryCount' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'step_id', type: 'varchar', length: 100 })
  stepId!: string

  @Property({ name: 'step_name', type: 'varchar', length: 255 })
  stepName!: string

  @Property({ name: 'step_type', type: 'varchar', length: 50 })
  stepType!: string

  @Property({ name: 'status', type: 'varchar', length: 20 })
  status!: StepInstanceStatus

  @Property({ name: 'input_data', type: 'jsonb', nullable: true })
  inputData?: any | null

  @Property({ name: 'output_data', type: 'jsonb', nullable: true })
  outputData?: any | null

  @Property({ name: 'error_data', type: 'jsonb', nullable: true })
  errorData?: any | null

  @Property({ name: 'entered_at', type: Date, nullable: true })
  enteredAt?: Date | null

  @Property({ name: 'exited_at', type: Date, nullable: true })
  exitedAt?: Date | null

  @Property({ name: 'execution_time_ms', type: 'integer', nullable: true })
  executionTimeMs?: number | null

  @Property({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number = 0

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ============================================================================
// Entity: UserTask
// ============================================================================

/**
 * UserTask entity
 *
 * Represents user tasks that require human interaction within a workflow.
 * Tracks assignment, SLA, escalation, and completion status.
 */
@Entity({ tableName: 'user_tasks' })
@Index({ name: 'user_tasks_workflow_instance_idx', properties: ['workflowInstanceId'] })
@Index({ name: 'user_tasks_status_assigned_idx', properties: ['status', 'assignedTo'] })
@Index({ name: 'user_tasks_status_due_date_idx', properties: ['status', 'dueDate'] })
@Index({ name: 'user_tasks_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class UserTask {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'step_instance_id', type: 'uuid' })
  stepInstanceId!: string

  @Property({ name: 'task_name', type: 'varchar', length: 255 })
  taskName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20 })
  status!: UserTaskStatus

  @Property({ name: 'form_schema', type: 'jsonb', nullable: true })
  formSchema?: any | null

  @Property({ name: 'form_data', type: 'jsonb', nullable: true })
  formData?: any | null

  @Property({ name: 'assigned_to', type: 'varchar', length: 255, nullable: true })
  assignedTo?: string | null

  @Property({ name: 'assigned_to_roles', type: 'text[]', nullable: true })
  assignedToRoles?: string[] | null

  @Property({ name: 'claimed_by', type: 'varchar', length: 255, nullable: true })
  claimedBy?: string | null

  @Property({ name: 'claimed_at', type: Date, nullable: true })
  claimedAt?: Date | null

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'escalated_at', type: Date, nullable: true })
  escalatedAt?: Date | null

  @Property({ name: 'escalated_to', type: 'varchar', length: 255, nullable: true })
  escalatedTo?: string | null

  @Property({ name: 'completed_by', type: 'varchar', length: 255, nullable: true })
  completedBy?: string | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'comments', type: 'text', nullable: true })
  comments?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ============================================================================
// Entity: WorkflowEvent
// ============================================================================

/**
 * WorkflowEvent entity
 *
 * Event sourcing log for workflow execution history.
 * Records all events that occur during workflow execution for audit and replay.
 */
@Entity({ tableName: 'workflow_events' })
@Index({ name: 'workflow_events_instance_occurred_idx', properties: ['workflowInstanceId', 'occurredAt'] })
@Index({ name: 'workflow_events_event_type_idx', properties: ['eventType', 'occurredAt'] })
@Index({ name: 'workflow_events_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowEvent {
  @PrimaryKey({ type: 'bigint', autoincrement: true })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'step_instance_id', type: 'uuid', nullable: true })
  stepInstanceId?: string | null

  @Property({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string

  @Property({ name: 'event_data', type: 'jsonb' })
  eventData!: any

  @Property({ name: 'occurred_at', type: Date, onCreate: () => new Date() })
  occurredAt: Date = new Date()

  @Property({ name: 'user_id', type: 'varchar', length: 255, nullable: true })
  userId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string
}

// Export all entities as default for MikroORM discovery
export default [
  WorkflowDefinition,
  WorkflowInstance,
  StepInstance,
  UserTask,
  WorkflowEvent,
]
