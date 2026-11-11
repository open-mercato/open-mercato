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
  branchInstanceId: z.string().uuid().nullable().optional(),
  taskName: z.string(),
  description: z.string().nullable().optional(),
  status: userTaskStatusSchema,
  formSchema: z.unknown().nullable().optional(),
  formData: z.unknown().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  assigneeKind: z
    .enum(['user', 'customer'])
    .describe('Which principal namespace assignedTo names — a backoffice user or a portal principal'),
  assignedToRoles: z.array(z.string()).nullable().optional(),
  entityTypes: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Distinct authored entity types of the bindings, denormalized for the visibility filter'),
  claimedBy: z.string().nullable().optional(),
  claimedAt: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  escalatedAt: z.string().nullable().optional(),
  escalatedTo: z.string().nullable().optional(),
  completedBy: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  reassignedBy: z.string().nullable().optional().describe('Who last reassigned this task'),
  reassignedAt: z.string().nullable().optional().describe('When it was last reassigned'),
  reassignReason: z.string().nullable().optional().describe('Why it was reassigned'),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string(),
  /** Optimistic-lock version — a reassign UI sends it back as the lock header. */
  updatedAt: z.string(),
})

/**
 * List projection: every field the raw-entity dump already returned, plus the
 * work-item fields consumers had to dig out of `formSchema` themselves (the
 * enterprise "Review proposal" row action read `row.proposalId`, which was
 * never there). Strictly a superset — BACKWARD_COMPATIBILITY.md §7 forbids
 * dropping a response field.
 */
export const userTaskRowSchema = userTaskSchema.extend({
  kind: z.literal('user_task').describe('Work-inbox source discriminator'),
  proposalId: z.string().nullable().describe('Agent proposal this task disposes, when any'),
  priority: z.union([z.string(), z.number()]).nullable(),
  entityBindings: z.array(z.unknown()).nullable().describe('Records this task is about, when authored'),
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

/**
 * A row the caller may know exists but may not read (design §3.6).
 *
 * Three fields and no fourth: the id (the argument to reassignment and to a
 * support conversation), the reason (an author's typo vs a policy refusal) and
 * the entity type that names the grant which would fix it. Nothing that says
 * what the task is ABOUT appears here — that is the difference between a
 * diagnostic and a leak.
 */
export const taskEntityHiddenMarkerSchema = z.object({
  id: z.string(),
  reason: z.enum(['denied:entity-access', 'denied:unknown-entity-type']),
  entityType: z.string().nullable(),
})

/**
 * Emitted only for a principal that already knows the rows are there — a
 * `workflows.tasks.view_all` holder or a superadmin. For everybody else the
 * entity gate removed those rows in SQL, `entityHidden` is empty and its
 * absence discloses nothing.
 *
 * `pagination.total` COUNTS the hidden rows, and that is deliberate: an
 * administrator asking "how much work is open?" wants the true number, and the
 * marker list is what explains why the page is shorter than it. Suppressing them
 * from the count would make the page short for no stated reason, which is the
 * silent disappearance §3.6 exists to prevent.
 */
export const taskListDiagnosticsSchema = z.object({
  entityHidden: z.array(taskEntityHiddenMarkerSchema),
  entityHiddenCount: z.number().int().nonnegative(),
})

export const userTaskListResponseSchema = z.object({
  data: z.array(userTaskRowSchema),
  pagination: paginationSchema,
  diagnostics: taskListDiagnosticsSchema.optional(),
})

/**
 * A decision button as the assignee sees it, re-resolved at request time from
 * the instance's pinned definition (never stored on the task row).
 */
export const userTaskDecisionSchema = z.object({
  id: z.string(),
  label: z.union([z.string(), z.record(z.string(), z.string())]),
  transitionId: z.string().describe('Durable id of the route this button takes'),
  style: z.enum(['primary', 'secondary', 'destructive']).optional(),
})

/**
 * Why an act surface is closed to a caller who can read the row.
 *
 * Each value is derivable from fields the same response already carries, except
 * `unavailable`, which is deliberately mute: it stands for the entity-gate
 * refusal the act routes answer as a bare 404, and naming the binding there
 * would leak it to the very caller the gate refused.
 */
export const taskActionBlockReasonSchema = z.enum([
  'not-workable',
  'owned-by-another',
  'not-in-your-queue',
  'unowned',
  'unavailable',
])

/**
 * Detail projection: the same superset the list returns, plus the derived
 * decision buttons, the definition step id they belong to, and the §6.4 act
 * surfaces.
 *
 * The `can*` flags are ADDITIVE (BACKWARD_COMPATIBILITY.md §7) and are the
 * server's own decision, not a hint: `workflows.tasks.view_all` makes a row
 * readable and leaves `canComplete` false, which is exactly the asymmetry the
 * page used to render wrong.
 */
export const userTaskDetailResponseSchema = z.object({
  data: userTaskRowSchema.extend({
    stepId: z.string().nullable().describe('Definition step the task is parked on'),
    decisions: z.array(userTaskDecisionSchema),
    canComplete: z.boolean().describe('The caller may complete or decide this task'),
    canClaim: z.boolean().describe('The caller may claim it off its role queue'),
    canRelease: z.boolean().describe('The caller holds the claim and may release it'),
    canReassign: z.boolean().describe('The caller may move it to another assignee or queue'),
    actBlockedReason: taskActionBlockReasonSchema
      .nullable()
      .describe('Why completion is unavailable; null when it is available'),
  }),
})

export const userTaskClaimResponseSchema = z.object({
  data: userTaskSchema,
  message: z.string(),
})

/**
 * Reassignment answers with the same row projection every other task surface
 * serves, so a client can refresh its copy — including the `reassignedBy` /
 * `reassignedAt` / `reassignReason` audit fields and the new `updatedAt` the
 * next optimistic-lock header must carry.
 */
export const userTaskReassignResponseSchema = z.object({
  data: userTaskRowSchema,
  message: z.string(),
})

// ============================================================================
// Work Inbox (spec §6.2/§6.3 — one queue over every registered source)
// ============================================================================

export const workInboxPrioritySchema = z.enum(['extreme', 'high', 'medium', 'low'])

export const workInboxEntityBindingSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  label: z.string().nullable().optional(),
})

export const workInboxActionSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  endpoint: z.string(),
  appliesTo: z.enum(['claimable', 'claimed-by-me', 'open', 'always']),
})

/**
 * Passthrough on purpose: a row carries its source's own payload alongside the
 * common projection, so a `user_task` row is a superset of a
 * `GET /api/workflows/tasks` row (that is what keeps `proposalId` reachable).
 */
export const workInboxRowSchema = z
  .object({
    id: z.string(),
    kind: z.string().describe('Source discriminator — user_task, agent_disposition, …'),
    moduleId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    priority: workInboxPrioritySchema.nullable(),
    dueDate: z.string().nullable(),
    overdue: z.boolean().describe('Derived: past due and not finished'),
    createdAt: z.string(),
    updatedAt: z.string(),
    assignedTo: z.string().nullable(),
    assignedToRoles: z.array(z.string()).nullable(),
    claimedBy: z.string().nullable(),
    entityTypes: z.array(z.string()),
    entityBindings: z.array(workInboxEntityBindingSchema),
    detailHref: z.string().nullable(),
    actions: z.array(workInboxActionSchema),
  })
  .passthrough()

export const workInboxListQuerySchema = z.object({
  kind: z.string().optional().describe('Filter by source kind (comma-separated)'),
  module: z.string().optional().describe('Filter by owning module id (comma-separated)'),
  entityType: z.string().optional().describe('Filter by bound entity type (comma-separated)'),
  role: z.string().optional().describe('Filter by queued role (comma-separated)'),
  priority: z.string().optional().describe('Filter by priority (comma-separated: extreme,high,medium,low)'),
  status: z.string().optional().describe('Filter by status (comma-separated)'),
  overdue: z.coerce.boolean().optional().describe('Only items past their due date'),
  myWork: z.coerce.boolean().optional().describe('Only items assigned to, claimed by, or queued to a role of the caller'),
  assignedTo: z.string().optional().describe('Filter by assignee'),
  workflowInstanceId: z.string().uuid().optional().describe('Filter by workflow instance'),
  limit: z.coerce.number().min(1).max(100).optional().default(50).describe('Number of results (max 100)'),
  offset: z.coerce.number().min(0).optional().default(0).describe('Pagination offset'),
})

export const workInboxListResponseSchema = z.object({
  data: z.array(workInboxRowSchema),
  pagination: paginationSchema,
  meta: z.object({
    kinds: z.array(z.string()).describe('Source kinds that answered this request'),
    degradedKinds: z.array(z.string()).describe('Source kinds that failed; their work is missing from this page'),
  }),
  diagnostics: taskListDiagnosticsSchema.optional(),
})

export const workInboxClaimNextResponseSchema = z.object({
  data: workInboxRowSchema.nullable().describe('The claimed item, or null when nothing was claimable'),
  message: z.string(),
})

export const completeTaskRequestSchema = z.object({
  formData: z.record(z.string(), z.unknown()).describe('Form field values'),
  comments: z.string().optional().describe('Optional comments'),
  decisionId: z
    .string()
    .optional()
    .describe('Decision button pressed; selects the outgoing route and is recorded with the completion'),
})

export const userTaskCompleteResponseSchema = z.object({
  data: userTaskSchema,
  message: z.string(),
})

/**
 * Portal task surface (design §7.4).
 *
 * A separate response envelope from the backoffice one on purpose: the portal
 * routes speak the portal convention (`{ ok, … }`, page/pageSize paging) that
 * every other `customer_accounts` portal route already speaks, and keeping the
 * two shapes apart means a future change to one cannot silently reshape the
 * other. The ROW projection is deliberately shared — a task is the same record
 * whoever reads it, and a divergent portal projection is how a field ends up
 * exposed on one surface and not the other.
 */
export const portalTaskErrorSchema = z
  .object({ ok: z.literal(false), error: z.string() })
  .describe('Portal error response')

export const portalTaskListQuerySchema = z.object({
  status: z.string().optional().describe('Filter by status (comma-separated for multiple)'),
  page: z.coerce.number().min(1).optional().default(1).describe('Page number'),
  pageSize: z.coerce.number().min(1).max(100).optional().default(25).describe('Rows per page (max 100)'),
})

export const portalPaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

export const portalTaskListResponseSchema = z.object({
  ok: z.literal(true),
  tasks: z.array(userTaskRowSchema),
  pagination: portalPaginationSchema,
})

export const portalTaskDetailResponseSchema = z.object({
  ok: z.literal(true),
  task: userTaskRowSchema,
  decisions: z.array(userTaskDecisionSchema),
  formKey: z.string().nullable().describe('External renderer key, when the author declared one'),
  canComplete: z
    .boolean()
    .describe('True only for the assignee; a portal admin reading a company member\'s task gets false'),
})

export const portalTaskCompleteRequestSchema = completeTaskRequestSchema

export const portalTaskCompleteResponseSchema = z.object({
  ok: z.literal(true),
  task: userTaskRowSchema.nullable(),
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

export const updateInstanceContextRequestSchema = z.object({
  context: z
    .record(z.string(), z.unknown())
    .describe('Partial context patch, shallow-merged into the running instance context'),
})

export const updateInstanceContextResponseSchema = z.object({
  ok: z.literal(true),
  instanceId: z.string(),
  woken: z.array(z.string()).describe('Step ids of the WAIT_FOR_CONDITION waiters that resumed'),
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
    grantedFeatures: z.array(z.string()).nullable(),
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

export const workflowRunOutcomeEnumSchema = z.enum([
  'success',
  'success_with_warnings',
  'partial_failure',
  'failure',
  'cancelled',
  'compensated',
])

export const workflowInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  workflowId: z.string(),
  version: z.number().int(),
  status: workflowInstanceStatusEnumSchema,
  // The run's VERDICT, additive alongside the lifecycle status. Null while the
  // run is still going, and null for ever on a row written before outcomes
  // existed — which means "ran before outcomes existed", never "success".
  outcome: workflowRunOutcomeEnumSchema.nullable().optional(),
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
// Step Instance Schemas (spec §8.3 per-step I/O inspector)
// ---------------------------------------------------------------------------

export const workflowStepInstanceRowSchema = z.object({
  id: z.string().uuid(),
  workflowInstanceId: z.string().uuid(),
  branchInstanceId: z.string().uuid().nullable().optional(),
  stepId: z.string(),
  stepName: z.string(),
  stepType: z.string(),
  status: z.string(),
  inputData: z.unknown().nullable().optional(),
  outputData: z.unknown().nullable().optional(),
  errorData: z.unknown().nullable().optional(),
  enteredAt: z.string().nullable().optional(),
  exitedAt: z.string().nullable().optional(),
  executionTimeMs: z.number().int().nullable().optional(),
  retryCount: z.number().int().nonnegative(),
})

export const workflowStepInstanceListResponseSchema = z.object({
  data: z.array(workflowStepInstanceRowSchema),
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
  labelKey: z.string().nullable().optional().describe('i18n key for a human label, supplied by the declaring module'),
  enabled: z.boolean().optional().describe('Whether this tenant has switched the command on'),
  defaultEnabled: z.boolean().optional().describe('Whether the declaration carries the grandfather clause, i.e. it is on for a tenant that never saved the setting'),
})

export const workflowSafeCommandListResponseSchema = z.object({
  items: z.array(workflowSafeCommandSchema),
})

export const workflowCommandSettingsResponseSchema = z.object({
  configured: z.boolean().describe('False when the tenant has never saved the setting and the answers are the grandfathered defaults'),
  items: z.array(workflowSafeCommandSchema),
})

export const workflowCommandSettingsPutBodySchema = z.object({
  enabledCommandIds: z
    .array(z.string().min(1))
    .max(500)
    .describe('The complete set of catalogue command ids to enable for this tenant'),
})

export const workflowCommandSettingsPutResponseSchema = workflowCommandSettingsResponseSchema.extend({
  ok: z.boolean(),
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
