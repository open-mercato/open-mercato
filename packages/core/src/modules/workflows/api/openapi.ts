import { z } from 'zod'

export const workflowsTag = 'Workflows'

export const workflowErrorSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .passthrough()

export const userTaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'ESCALATED',
])

export const userTaskSchema = z.object({
  id: z.string().uuid(),
  workflowInstanceId: z.string().uuid(),
  stepInstanceId: z.string().uuid(),
  taskName: z.string(),
  description: z.string().nullable().optional(),
  status: userTaskStatusSchema,
  formSchema: z.unknown().nullable().optional(),
  formData: z.unknown().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  assignedToRoles: z.array(z.string()).nullable().optional(),
  claimedBy: z.string().nullable().optional(),
  claimedAt: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  escalatedAt: z.string().nullable().optional(),
  escalatedTo: z.string().nullable().optional(),
  completedBy: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const userTaskListQuerySchema = z.object({
  status: z.string().optional().describe('Filter by status (comma-separated for multiple: PENDING,IN_PROGRESS,COMPLETED,CANCELLED,ESCALATED)'),
  assignedTo: z.string().uuid().optional().describe('Filter by assigned user ID'),
  workflowInstanceId: z.string().uuid().optional().describe('Filter by workflow instance ID'),
  overdue: z.coerce.boolean().optional().describe('Filter overdue tasks (true/false)'),
  myTasks: z.coerce.boolean().optional().describe('Show only tasks assigned to or claimable by current user'),
  limit: z.coerce.number().min(1).max(100).optional().default(50).describe('Number of results (max 100)'),
  offset: z.coerce.number().min(0).optional().default(0).describe('Pagination offset'),
})

export const paginationSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})

export const userTaskListResponseSchema = z.object({
  data: z.array(userTaskSchema),
  pagination: paginationSchema,
})

export const userTaskDetailResponseSchema = z.object({
  data: userTaskSchema,
})

export const userTaskClaimResponseSchema = z.object({
  data: userTaskSchema,
  message: z.string(),
})

export const completeTaskRequestSchema = z.object({
  formData: z.record(z.string(), z.unknown()).describe('Form field values'),
  comments: z.string().optional().describe('Optional comments'),
})

export const userTaskCompleteResponseSchema = z.object({
  data: userTaskSchema,
  message: z.string(),
})

export const advanceWorkflowRequestSchema = z.object({
  toStepId: z.string().optional().describe('Optional target step ID; first valid transition is used when omitted'),
  triggerData: z.record(z.string(), z.unknown()).optional().describe('Optional trigger data used during transition evaluation'),
  contextUpdates: z.record(z.string(), z.unknown()).optional().describe('Optional workflow context updates applied before transition'),
})

export const advanceWorkflowResponseSchema = z.object({
  data: z.object({
    instance: z.object({
      id: z.string().uuid(),
      status: z.string(),
      currentStepId: z.string().nullable(),
      previousStepId: z.string().nullable(),
      transitionFired: z.string().nullable(),
      context: z.unknown(),
    }),
    execution: z.unknown(),
  }),
  message: z.string(),
})

export const sendSignalRequestSchema = z.object({
  signalName: z.string().describe('Name of the signal to send'),
  payload: z.record(z.string(), z.unknown()).optional().describe('Optional data payload for the signal'),
})

export const sendSignalResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
})

export const validateStartRequestSchema = z.object({
  workflowId: z.string().min(1).describe('Workflow definition ID'),
  version: z.number().int().positive().optional().describe('Optional workflow definition version'),
  context: z.record(z.string(), z.unknown()).optional().describe('Initial workflow context variables'),
  locale: z.string().optional().describe('Locale for validation messages'),
})

export const validateStartErrorSchema = z.object({
  ruleId: z.string(),
  message: z.string(),
  code: z.string(),
})

export const validateStartRuleSchema = z.object({
  ruleId: z.string(),
  passed: z.boolean(),
  executionTime: z.number().optional(),
})

export const validateStartResponseSchema = z.object({
  canStart: z.boolean(),
  workflowId: z.string(),
  errors: z.array(validateStartErrorSchema).optional(),
  validatedRules: z.array(validateStartRuleSchema).optional(),
})

// ---------------------------------------------------------------------------
// Workflow Instance Response Schemas
// ---------------------------------------------------------------------------

export const workflowInstanceStatusEnumSchema = z.enum([
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'COMPENSATING',
  'COMPENSATED',
  'WAITING_FOR_ACTIVITIES',
])

export const workflowInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  workflowId: z.string(),
  version: z.number().int(),
  status: workflowInstanceStatusEnumSchema,
  currentStepId: z.string(),
  context: z.unknown(),
  correlationKey: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  pausedAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  errorDetails: z.unknown().nullable().optional(),
  pendingTransition: z.unknown().nullable().optional(),
  retryCount: z.number().int(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().optional(),
})

export const workflowInstanceListResponseSchema = z.object({
  data: z.array(workflowInstanceResponseSchema),
  pagination: paginationSchema,
})

export const workflowInstanceDetailResponseSchema = z.object({
  data: workflowInstanceResponseSchema,
})

export const workflowInstanceCancelResponseSchema = z.object({
  data: workflowInstanceResponseSchema,
  message: z.string(),
})

// ---------------------------------------------------------------------------
// Workflow Execution Result Schemas
// ---------------------------------------------------------------------------

export const workflowEventSummarySchema = z.object({
  eventType: z.string(),
  occurredAt: z.string(),
  data: z.unknown().optional(),
})

export const workflowExecutionResultSchema = z.object({
  status: workflowInstanceStatusEnumSchema,
  currentStep: z.string(),
  context: z.unknown(),
  events: z.array(workflowEventSummarySchema),
  errors: z.array(z.string()).optional(),
  executionTime: z.number(),
})

export const workflowBackgroundStartSchema = z.object({
  status: workflowInstanceStatusEnumSchema,
  currentStep: z.string(),
  message: z.string(),
})

export const workflowInstanceCreateResponseSchema = z.object({
  data: z.object({
    instance: workflowInstanceResponseSchema,
    execution: workflowBackgroundStartSchema,
  }),
  message: z.string(),
})

export const workflowInstanceRetryResponseSchema = z.object({
  data: z.object({
    instance: workflowInstanceResponseSchema,
    execution: workflowExecutionResultSchema,
  }),
  message: z.string(),
})

// ---------------------------------------------------------------------------
// Workflow Event Response Schemas
// ---------------------------------------------------------------------------

export const workflowEventRowSchema = z.object({
  id: z.string(),
  workflowInstanceId: z.string().uuid(),
  stepInstanceId: z.string().uuid().nullable().optional(),
  eventType: z.string(),
  eventData: z.unknown(),
  occurredAt: z.string(),
  userId: z.string().nullable().optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const workflowEventInstanceSummarySchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string(),
  workflowName: z.string(),
  status: workflowInstanceStatusEnumSchema,
})

export const workflowEventListItemSchema = z.object({
  id: z.string(),
  workflowInstanceId: z.string().uuid(),
  stepInstanceId: z.string().uuid().nullable().optional(),
  eventType: z.string(),
  eventData: z.unknown(),
  occurredAt: z.string(),
  userId: z.string().nullable().optional(),
  workflowInstance: workflowEventInstanceSummarySchema.nullable(),
})

export const workflowEventListResponseSchema = z.object({
  items: z.array(workflowEventListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

export const workflowEventInstanceDetailSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string(),
  version: z.number().int(),
  status: workflowInstanceStatusEnumSchema,
  currentStepId: z.string(),
  correlationKey: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  context: z.unknown(),
})

export const workflowEventDetailSchema = z.object({
  id: z.string(),
  workflowInstanceId: z.string().uuid(),
  stepInstanceId: z.string().uuid().nullable().optional(),
  eventType: z.string(),
  eventData: z.unknown(),
  occurredAt: z.string(),
  userId: z.string().nullable().optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  workflowInstance: workflowEventInstanceDetailSchema.nullable(),
})

export const workflowEventRowListResponseSchema = z.object({
  data: z.array(workflowEventRowSchema),
  pagination: paginationSchema,
})

// ---------------------------------------------------------------------------
// Signal Schemas
// ---------------------------------------------------------------------------

export const sendSignalByCorrelationRequestSchema = z.object({
  correlationKey: z.string().min(1).describe('Correlation key used to target waiting workflow instances'),
  signalName: z.string().min(1).describe('Signal name to deliver'),
  payload: z.record(z.string(), z.unknown()).optional().describe('Optional data payload for the signal'),
})

export const sendSignalByCorrelationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  count: z.number().int().nonnegative(),
})
