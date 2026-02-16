import { z } from 'zod'

export const workflowsTag = 'Workflows'

// ============================================================================
// Common Schemas
// ============================================================================

export const workflowErrorSchema = z
  .object({
    error: z.string(),
    details: z.any().optional(),
  })
  .passthrough()

// ============================================================================
// User Task Schemas
// ============================================================================

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
  formSchema: z.any().nullable().optional(),
  formData: z.any().nullable().optional(),
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
  formData: z.record(z.string(), z.any()).describe('Form field values'),
  comments: z.string().optional().describe('Optional comments'),
})

export const userTaskCompleteResponseSchema = z.object({
  data: userTaskSchema,
  message: z.string(),
})

// ============================================================================
// Workflow Instance Schemas
// ============================================================================

export const advanceWorkflowRequestSchema = z.object({
  signal: z.string().optional().describe('Optional signal name to advance'),
})

export const advanceWorkflowResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
})

export const sendSignalRequestSchema = z.object({
  signalName: z.string().describe('Name of the signal to send'),
  signalData: z.any().optional().describe('Optional data payload for the signal'),
})

export const sendSignalResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
})

export const validateStartRequestSchema = z.object({
  workflowId: z.string().uuid().describe('Workflow definition ID'),
  initialContext: z.record(z.string(), z.any()).optional().describe('Initial workflow context variables'),
})

export const validateStartResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).optional(),
})

export const registerSignalRequestSchema = z.object({
  signalName: z.string().describe('Unique signal name'),
  description: z.string().optional().describe('Signal description'),
})

export const registerSignalResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
})
