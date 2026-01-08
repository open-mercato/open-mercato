import { z } from 'zod'

/**
 * Workflows Module - Zod Validators
 *
 * Comprehensive validation schemas for workflow engine entities.
 */

const uuid = z.uuid()

// ============================================================================
// Enum Schemas - Workflow Types and Statuses
// ============================================================================

export const workflowStepTypeSchema = z.enum([
  'START',
  'END',
  'USER_TASK',
  'AUTOMATED',
  'PARALLEL_FORK',
  'PARALLEL_JOIN',
  'SUB_WORKFLOW',
  'WAIT_FOR_SIGNAL',
  'WAIT_FOR_TIMER',
])
export type WorkflowStepType = z.infer<typeof workflowStepTypeSchema>

export const workflowInstanceStatusSchema = z.enum([
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'COMPENSATING',
  'COMPENSATED',
])
export type WorkflowInstanceStatus = z.infer<typeof workflowInstanceStatusSchema>

export const stepInstanceStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
])
export type StepInstanceStatus = z.infer<typeof stepInstanceStatusSchema>

export const userTaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'ESCALATED',
])
export type UserTaskStatus = z.infer<typeof userTaskStatusSchema>

export const transitionTriggerSchema = z.enum(['auto', 'manual', 'signal', 'timer'])
export type TransitionTrigger = z.infer<typeof transitionTriggerSchema>

export const activityTypeSchema = z.enum([
  'SEND_EMAIL',
  'CALL_API',
  'UPDATE_ENTITY',
  'EMIT_EVENT',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
])
export type ActivityType = z.infer<typeof activityTypeSchema>

export const escalationTriggerSchema = z.enum(['sla_breach', 'no_progress', 'custom'])
export type EscalationTrigger = z.infer<typeof escalationTriggerSchema>

export const escalationActionSchema = z.enum(['reassign', 'notify', 'escalate'])
export type EscalationAction = z.infer<typeof escalationActionSchema>

// ============================================================================
// Complex Object Schemas - Workflow Definition Components
// ============================================================================

// User task configuration
export const userTaskConfigSchema = z.object({
  formSchema: z.object({
    fields: z.array(z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      label: z.string().min(1),
      required: z.boolean().optional(),
      options: z.array(z.any()).optional(),
    }))
  }).optional(),
  assignedTo: z.union([
    z.string(),
    z.array(z.string()),
  ]).optional(),
  assignmentRule: z.string().optional(), // Business rule ID
  slaDuration: z.string().optional(), // ISO 8601 duration
  escalationRules: z.array(z.object({
    trigger: escalationTriggerSchema,
    action: escalationActionSchema,
    escalateTo: z.string().optional(),
    notifyUsers: z.array(z.string()).optional(),
  })).optional(),
})

// Sub-workflow configuration (Phase 8)
export const subWorkflowConfigSchema = z.object({
  subWorkflowId: z.string().min(1, 'Sub-workflow ID is required'),
  version: z.number().int().positive().optional(),
  inputMapping: z.record(z.string(), z.string()).optional(),
  outputMapping: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
})

// Retry policy
export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(0),
})

// Activity retry policy (more detailed)
export const activityRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  initialIntervalMs: z.number().int().min(0),
  backoffCoefficient: z.number().min(1).max(10),
  maxIntervalMs: z.number().int().min(0),
})

// Step definition
export const workflowStepSchema = z.object({
  stepId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Step ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  stepName: z.string().min(1).max(255),
  stepType: workflowStepTypeSchema,
  description: z.string().max(1000).optional(),
  config: z.record(z.string(), z.any()).optional(),
  userTaskConfig: userTaskConfigSchema.optional(),
  subWorkflowConfig: subWorkflowConfigSchema.optional(),
  timeout: z.string().optional(), // ISO 8601 duration
  retryPolicy: retryPolicySchema.optional(),
})

// Transition condition (reference to business rule)
export const transitionConditionSchema = z.object({
  ruleId: z.string().min(1).max(50), // Business rule ID
  required: z.boolean().default(true),
})

// Activity definition (embedded in transitions)
export const activityDefinitionSchema = z.object({
  activityId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Activity ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  activityName: z.string().min(1).max(255),
  activityType: activityTypeSchema,
  config: z.record(z.string(), z.any()),
  async: z.boolean().default(false).optional(), // For Phase 8
  retryPolicy: activityRetryPolicySchema.optional(),
  timeout: z.string().optional(), // ISO 8601 duration
  compensate: z.boolean().default(false).optional(), // Flag to execute compensation on failure
})

// Transition definition
export const workflowTransitionSchema = z.object({
  transitionId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Transition ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  fromStepId: z.string().min(1).max(100),
  toStepId: z.string().min(1).max(100),
  transitionName: z.string().max(255).optional(),
  trigger: transitionTriggerSchema,
  preConditions: z.array(transitionConditionSchema).optional(),
  postConditions: z.array(transitionConditionSchema).optional(),
  activities: z.array(activityDefinitionSchema).optional(), // Activities to execute during transition
  continueOnActivityFailure: z.boolean().default(true).optional(), // If false, transition fails when any activity fails
  priority: z.number().int().min(0).max(9999).default(0),
})

// Workflow definition data (JSONB structure)
export const workflowDefinitionDataSchema = z.object({
  steps: z.array(workflowStepSchema).min(2, 'Workflow must have at least START and END steps'),
  transitions: z.array(workflowTransitionSchema).min(1, 'Workflow must have at least one transition'),
  queries: z.array(z.any()).optional(), // For Phase 7
  signals: z.array(z.any()).optional(), // For Phase 9
  timers: z.array(z.any()).optional(), // For Phase 9
})

// Workflow metadata
export const workflowMetadataSchema = z.object({
  tags: z.array(z.string().max(50)).optional(),
  category: z.string().max(100).optional(),
  icon: z.string().max(100).optional(),
})

// Date preprocessing helper
const dateOrNull = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}, z.date().nullable())

// ============================================================================
// WorkflowDefinition Schemas
// ============================================================================

// Full schema for database entities (includes tenant fields)
export const createWorkflowDefinitionSchema = z.object({
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Workflow ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  workflowName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  version: z.number().int().positive().default(1),
  definition: workflowDefinitionDataSchema,
  metadata: workflowMetadataSchema.optional().nullable(),
  enabled: z.boolean().default(true),
  effectiveFrom: dateOrNull.optional(),
  effectiveTo: dateOrNull.optional(),
  tenantId: uuid,
  organizationId: uuid,
  createdBy: z.string().max(255).optional().nullable(),
})

export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>

// API input schema (omits tenant fields - injected from auth context)
export const createWorkflowDefinitionInputSchema = z.object({
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Workflow ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  workflowName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  version: z.number().int().positive().default(1),
  definition: workflowDefinitionDataSchema,
  metadata: workflowMetadataSchema.optional().nullable(),
  enabled: z.boolean().default(true).optional(),
})

export type CreateWorkflowDefinitionApiInput = z.infer<typeof createWorkflowDefinitionInputSchema>

export const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial().extend({
  id: uuid,
})

export type UpdateWorkflowDefinitionInput = z.infer<typeof updateWorkflowDefinitionSchema>

// API update schema (omits tenant fields and allows partial updates)
export const updateWorkflowDefinitionInputSchema = z.object({
  definition: workflowDefinitionDataSchema.optional(),
  enabled: z.boolean().optional(),
}).strict()

export type UpdateWorkflowDefinitionApiInput = z.infer<typeof updateWorkflowDefinitionInputSchema>

export const workflowDefinitionFilterSchema = z.object({
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type WorkflowDefinitionFilter = z.infer<typeof workflowDefinitionFilterSchema>

// ============================================================================
// WorkflowInstance Schemas
// ============================================================================

export const workflowInstanceMetadataSchema = z.object({
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(255).optional(),
  initiatedBy: z.string().max(255).optional(),
  labels: z.record(z.string(), z.string()).optional(),
})

export const createWorkflowInstanceSchema = z.object({
  definitionId: uuid,
  workflowId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  status: workflowInstanceStatusSchema,
  currentStepId: z.string().min(1).max(100),
  context: z.record(z.string(), z.any()),
  correlationKey: z.string().max(255).optional().nullable(),
  metadata: workflowInstanceMetadataSchema.optional().nullable(),
  startedAt: z.coerce.date(),
  completedAt: dateOrNull.optional(),
  pausedAt: dateOrNull.optional(),
  cancelledAt: dateOrNull.optional(),
  errorMessage: z.string().max(5000).optional().nullable(),
  errorDetails: z.any().optional().nullable(),
  retryCount: z.number().int().min(0).default(0),
  tenantId: uuid,
  organizationId: uuid,
})

export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>

export const updateWorkflowInstanceSchema = createWorkflowInstanceSchema.partial().extend({
  id: uuid,
})

export type UpdateWorkflowInstanceInput = z.infer<typeof updateWorkflowInstanceSchema>

export const workflowInstanceFilterSchema = z.object({
  definitionId: uuid.optional(),
  workflowId: z.string().optional(),
  status: workflowInstanceStatusSchema.optional(),
  correlationKey: z.string().optional(),
  currentStepId: z.string().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type WorkflowInstanceFilter = z.infer<typeof workflowInstanceFilterSchema>

// ============================================================================
// StepInstance Schemas
// ============================================================================

export const createStepInstanceSchema = z.object({
  workflowInstanceId: uuid,
  stepId: z.string().min(1).max(100),
  stepName: z.string().min(1).max(255),
  stepType: z.string().min(1).max(50),
  status: stepInstanceStatusSchema,
  inputData: z.any().optional().nullable(),
  outputData: z.any().optional().nullable(),
  errorData: z.any().optional().nullable(),
  enteredAt: dateOrNull.optional(),
  exitedAt: dateOrNull.optional(),
  executionTimeMs: z.number().int().min(0).optional().nullable(),
  retryCount: z.number().int().min(0).default(0),
  tenantId: uuid,
  organizationId: uuid,
})

export type CreateStepInstanceInput = z.infer<typeof createStepInstanceSchema>

export const updateStepInstanceSchema = createStepInstanceSchema.partial().extend({
  id: uuid,
})

export type UpdateStepInstanceInput = z.infer<typeof updateStepInstanceSchema>

export const stepInstanceFilterSchema = z.object({
  workflowInstanceId: uuid.optional(),
  stepId: z.string().optional(),
  status: stepInstanceStatusSchema.optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type StepInstanceFilter = z.infer<typeof stepInstanceFilterSchema>

// ============================================================================
// UserTask Schemas
// ============================================================================

export const createUserTaskSchema = z.object({
  workflowInstanceId: uuid,
  stepInstanceId: uuid,
  taskName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  status: userTaskStatusSchema,
  formSchema: z.any().optional().nullable(),
  formData: z.any().optional().nullable(),
  assignedTo: z.string().max(255).optional().nullable(),
  assignedToRoles: z.array(z.string().max(100)).optional().nullable(),
  claimedBy: z.string().max(255).optional().nullable(),
  claimedAt: dateOrNull.optional(),
  dueDate: dateOrNull.optional(),
  escalatedAt: dateOrNull.optional(),
  escalatedTo: z.string().max(255).optional().nullable(),
  completedBy: z.string().max(255).optional().nullable(),
  completedAt: dateOrNull.optional(),
  comments: z.string().max(5000).optional().nullable(),
  tenantId: uuid,
  organizationId: uuid,
})

export type CreateUserTaskInput = z.infer<typeof createUserTaskSchema>

export const updateUserTaskSchema = createUserTaskSchema.partial().extend({
  id: uuid,
})

export type UpdateUserTaskInput = z.infer<typeof updateUserTaskSchema>

export const userTaskFilterSchema = z.object({
  workflowInstanceId: uuid.optional(),
  status: userTaskStatusSchema.optional(),
  assignedTo: z.string().optional(),
  claimedBy: z.string().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type UserTaskFilter = z.infer<typeof userTaskFilterSchema>

// ============================================================================
// WorkflowEvent Schemas
// ============================================================================

export const createWorkflowEventSchema = z.object({
  workflowInstanceId: uuid,
  stepInstanceId: uuid.optional().nullable(),
  eventType: z.string().min(1).max(50),
  eventData: z.any(),
  occurredAt: z.coerce.date().optional(),
  userId: z.string().max(255).optional().nullable(),
  tenantId: uuid,
  organizationId: uuid,
})

export type CreateWorkflowEventInput = z.infer<typeof createWorkflowEventSchema>

export const workflowEventFilterSchema = z.object({
  workflowInstanceId: uuid.optional(),
  stepInstanceId: uuid.optional(),
  eventType: z.string().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  occurredAtFrom: z.date().optional(),
  occurredAtTo: z.date().optional(),
})

export type WorkflowEventFilter = z.infer<typeof workflowEventFilterSchema>

// ============================================================================
// Workflow Execution Context Schema
// ============================================================================

export const workflowExecutionContextSchema = z.looseObject({
  workflowId: z.string().min(1),
  version: z.number().int().positive().optional(),
  correlationKey: z.string().optional(),
  context: z.record(z.string(), z.any()).optional(),
  metadata: workflowInstanceMetadataSchema.optional(),
  tenantId: z.uuid('tenantId must be a valid UUID'),
  organizationId: z.uuid('organizationId must be a valid UUID'),
  initiatedBy: z.string().optional(),
})

export type WorkflowExecutionContextInput = z.infer<typeof workflowExecutionContextSchema>

// API input schema (omits tenant fields - injected from auth context)
export const startWorkflowInputSchema = z.object({
  workflowId: z.string().min(1),
  version: z.number().int().positive().optional(),
  correlationKey: z.string().optional(),
  initialContext: z.record(z.string(), z.any()).optional(),
  metadata: workflowInstanceMetadataSchema.optional(),
})

export type StartWorkflowApiInput = z.infer<typeof startWorkflowInputSchema>
