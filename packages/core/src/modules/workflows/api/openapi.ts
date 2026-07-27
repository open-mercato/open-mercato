import { z } from 'zod'
import { workflowDefinitionDataSchema, workflowDefinitionDraftDataSchema } from '../data/validators'

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
// Workflow Definition Response Schemas
// ---------------------------------------------------------------------------

export const workflowDefinitionSourceSchema = z.enum(['code', 'code_override', 'user'])

export const workflowDefinitionResponseSchema = z
  .object({
    id: z.string().describe('UUID for DB definitions, or "code:<workflowId>" for code-based definitions'),
    workflowId: z.string(),
    workflowName: z.string(),
    description: z.string().nullable(),
    version: z.number().int(),
    definition: workflowDefinitionDataSchema,
    metadata: z.record(z.string(), z.unknown()).nullable(),
    enabled: z.boolean(),
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    tenantId: z.string().nullable(),
    organizationId: z.string().nullable(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    deletedAt: z.string().nullable(),
    source: workflowDefinitionSourceSchema,
    isCodeBased: z.boolean(),
    codeModuleId: z.string().nullable(),
  })
  .passthrough()

export const workflowDefinitionListResponseSchema = z.object({
  data: z.array(workflowDefinitionResponseSchema),
  pagination: paginationSchema,
})

export const workflowDefinitionDetailResponseSchema = z.object({
  data: workflowDefinitionResponseSchema,
})

export const workflowDefinitionMutationResponseSchema = z.object({
  data: workflowDefinitionResponseSchema,
  message: z.string(),
})

export const workflowDefinitionResetResponseSchema = z.object({
  data: workflowDefinitionResponseSchema.nullable(),
  message: z.string(),
})

export const workflowDefinitionDeleteResponseSchema = z.object({
  message: z.string(),
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

// ---------------------------------------------------------------------------
// Workflow-Safe Command Schemas
// ---------------------------------------------------------------------------

export const workflowSafeCommandSchema = z.object({
  commandId: z.string().min(1).describe('Command bus id allowlisted for UPDATE_ENTITY activities'),
  requiredFeatures: z.array(z.string()).min(1).describe('ACL features the workflow actor must hold to run the command'),
})

export const workflowSafeCommandListResponseSchema = z.object({
  items: z.array(workflowSafeCommandSchema),
})

// ---------------------------------------------------------------------------
// Workflow Function Schemas
// ---------------------------------------------------------------------------

export const workflowFunctionSchema = z.object({
  name: z.string().min(1).describe('DI-registered function name resolved as workflowFunction:<name> by EXECUTE_FUNCTION activities'),
  labelKey: z.string().optional().describe('Optional i18n key for a human-readable label'),
  description: z.string().optional().describe('Optional description of what the function does'),
})

export const workflowFunctionListResponseSchema = z.object({
  items: z.array(workflowFunctionSchema),
})

// ---------------------------------------------------------------------------
// Workflow Endpoint Catalog Schemas
// ---------------------------------------------------------------------------

export const workflowEndpointParamSchema = z.object({
  name: z.string().min(1).describe('Parameter name'),
  in: z.enum(['path', 'query', 'header']).describe('Where the parameter is sent'),
  required: z.boolean().describe('Whether the endpoint requires the parameter'),
  type: z.string().describe('JSON-schema primitive type of the parameter, or "unknown"'),
})

export const workflowEndpointSchema = z.object({
  path: z.string().min(1).describe('Endpoint path with the /api prefix and {param} placeholders'),
  method: z.string().min(1).describe('HTTP method'),
  summary: z.string().describe('Human-readable endpoint summary'),
  tag: z.string().describe('OpenAPI tag used to group endpoints in the picker'),
  params: z.array(workflowEndpointParamSchema).describe('Path/query/header parameters split required vs optional'),
  hasRequestSchema: z.boolean().describe('Whether the endpoint declares a JSON request body schema'),
  requestSchema: z.record(z.string(), z.unknown()).optional().describe('Declared JSON schema of the request body, when available'),
  responseSchema: z.record(z.string(), z.unknown()).optional().describe('Declared JSON schema of the success response; omitted when the route declares none'),
})

export const workflowEndpointListResponseSchema = z.object({
  items: z.array(workflowEndpointSchema),
})

// ---------------------------------------------------------------------------
// Workflow Template Schemas
// ---------------------------------------------------------------------------

export const workflowTemplateSchema = z.object({
  id: z.string().min(1).describe('Stable template identifier (kebab-case)'),
  nameKey: z.string().min(1).describe('i18n key resolving to the template display name'),
  descriptionKey: z.string().min(1).describe('i18n key resolving to the template description'),
  category: z.string().min(1).describe('Gallery grouping category'),
  icon: z.string().min(1).describe('Lucide icon name for the gallery card'),
  definition: workflowDefinitionDataSchema.describe('Complete workflow definition the template seeds'),
})

export const workflowTemplateListResponseSchema = z.object({
  items: z.array(workflowTemplateSchema),
})

// ---------------------------------------------------------------------------
// Workflow Definition Draft Schemas
// ---------------------------------------------------------------------------

export const workflowDefinitionDraftResponseSchema = z.object({
  id: z.string().describe('Draft row UUID'),
  definitionId: z.string().nullable().describe('The workflow definition this draft belongs to'),
  definition: workflowDefinitionDraftDataSchema.describe('The autosaved (possibly incomplete) workflow definition'),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  baseUpdatedAt: z.string().nullable().describe('The definition updatedAt the draft forked from, for conflict-aware restore'),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const workflowDefinitionDraftDetailResponseSchema = z.object({
  data: workflowDefinitionDraftResponseSchema,
})

export const workflowDefinitionDraftMutationResponseSchema = z.object({
  data: workflowDefinitionDraftResponseSchema,
  message: z.string(),
})

export const workflowDefinitionDraftDeleteResponseSchema = z.object({
  message: z.string(),
})

// ---------------------------------------------------------------------------
// Workflow Context Schema (per-step ledger) Schemas
// ---------------------------------------------------------------------------

export const ledgerEntrySourceSchema = z.object({
  kind: z.enum([
    'contextSchema',
    'trigger',
    'activity',
    'setVariable',
    'userTask',
    'signal',
    'subWorkflow',
    'join',
    'asyncResult',
  ]).describe('What kind of producer contributes this context entry'),
  stepId: z.string().optional().describe('Producing step, when the producer is step-bound'),
  activityId: z.string().optional().describe('Producing activity, when the producer is an activity'),
  label: z.string().describe('Stable machine-readable producer label (e.g. "trigger:<id>:payload")'),
})

export const ledgerEntrySchema = z.object({
  path: z.string().describe('Dot path in workflow context ("*" is the untyped whole-payload wildcard)'),
  type: z.enum(['text', 'number', 'boolean', 'select', 'date', 'object', 'unknown']),
  presence: z.enum(['always', 'maybe']).describe('"always" only when the entry is present on every incoming route'),
  source: ledgerEntrySourceSchema,
})

export const workflowContextSchemaStepSchema = z.object({
  entries: z.array(ledgerEntrySchema),
})

export const workflowContextSchemaResponseSchema = z.object({
  steps: z.record(z.string(), workflowContextSchemaStepSchema).describe('Per-step incoming context ledger, keyed by stepId'),
})

// ---------------------------------------------------------------------------
// Workflow Test-Step (mock-first dry run) Schemas
// ---------------------------------------------------------------------------

export const workflowTestStepRequestSchema = z.object({
  stepId: z.string().optional().describe('Editor step the test targets; used as the synthetic currentStepId during interpolation'),
  activityType: z.string().describe('Registered activity type id (e.g. SEND_EMAIL)'),
  config: z.record(z.string(), z.unknown()).describe('Raw activity config, possibly containing {{...}} templates'),
  context: z.record(z.string(), z.unknown()).optional().describe('Caller-supplied sample workflow context interpolated into the config'),
})

export const workflowTestStepSimulatedResponseSchema = z.object({
  simulated: z.literal(true),
  activityType: z.string(),
  output: z.unknown().describe('The would-do mock output for the activity type'),
  interpolatedConfig: z.record(z.string(), z.unknown()).describe('Config after variable interpolation, so the UI can show resolved values'),
})

export const workflowTestStepRefusedResponseSchema = z.object({
  refused: z.literal(true),
  reason: z.enum(['refused', 'noMock']).describe('"refused": the type opts out of simulation; "noMock": the type declares no mock'),
  activityType: z.string(),
})

export const workflowTestStepInterpolationFailedResponseSchema = z.object({
  interpolationFailed: z.literal(true),
  token: z.string().describe('The offending {{ }} token, without the braces'),
  message: z.string().describe('Why the token could not be interpolated under strict mode'),
  activityType: z.string(),
})

export const workflowTestStepResponseSchema = z.union([
  workflowTestStepSimulatedResponseSchema,
  workflowTestStepRefusedResponseSchema,
  workflowTestStepInterpolationFailedResponseSchema,
])
