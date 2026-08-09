import { z } from 'zod'
import { conditionExpressionSchema } from '@open-mercato/core/modules/business_rules/data/validators'
import { validateConditionExpressionForApi } from '@open-mercato/core/modules/business_rules/lib/payload-validation'
import { parseDuration } from '../lib/duration'
import { excludeNonNormalTransitions } from '../lib/route-kinds'
import { WORKFLOW_RUN_OUTCOMES } from '../lib/run-outcome'
import {
  WORKFLOW_START_FIXTURES_MAX_CHARS,
  WORKFLOW_START_FIXTURES_MAX_COUNT,
  WORKFLOW_START_FIXTURE_NAME_MAX,
} from '../lib/start-fixtures'
import '../lib/activity-registry-bootstrap'
import { activityTypeIds } from '../lib/activity-registry'
import {
  DURATION_ERROR,
  UNTIL_ERROR,
  UNTIL_PAST_ERROR,
  invokeAgentConfigSchema,
  isFutureIsoDateString,
  isValidDurationString,
  isValidIsoDateString,
} from './activity-config-schemas'
import {
  taskDeadlineSchema,
  taskPrioritySchema,
  taskReminderSchema,
} from './task-primitives'

/**
 * Workflows Module - Zod Validators
 *
 * Comprehensive validation schemas for workflow engine entities.
 *
 * Per-type activity config schemas live in activity-config-schemas.ts (the
 * registry bootstrap depends on them, and this module depends on the
 * bootstrap for the registry-driven activityTypeSchema) and are re-exported
 * here to keep the historical import surface stable.
 */

export {
  isValidDurationString,
  isValidIsoDateString,
  isFutureIsoDateString,
  callApiConfigSchema,
  callWebhookConfigSchema,
  sendEmailConfigSchema,
  emitEventConfigSchema,
  updateEntityConfigSchema,
  executeFunctionConfigSchema,
  invokeAgentConfigSchema,
  setVariableAssignmentSchema,
  setVariableConfigSchema,
  waitConfigSchema,
} from './activity-config-schemas'
export type {
  CallWebhookConfig,
  SendEmailConfig,
  EmitEventConfig,
  UpdateEntityConfig,
  ExecuteFunctionConfig,
  InvokeAgentConfig,
  SetVariableConfig,
  WaitConfig,
} from './activity-config-schemas'

export {
  taskPrioritySchema,
  taskDeadlineSchema,
  taskReminderSchema,
} from './task-primitives'
export type { TaskPriority, TaskDeadline, TaskReminder } from './task-primitives'

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
  'WAIT_FOR_CONDITION',
  'IF_ELSE',
  'SWITCH',
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
  'WAITING_FOR_ACTIVITIES',
  'FORKED',
])
export type WorkflowInstanceStatus = z.infer<typeof workflowInstanceStatusSchema>

/**
 * Terminal run VERDICT (`WorkflowInstance.outcome`), additive alongside the
 * lifecycle `status`. The tuple lives in the pure `lib/run-outcome.ts` so the
 * engine, the schema and the read routes cannot drift apart.
 */
export const workflowRunOutcomeSchema = z.enum(
  WORKFLOW_RUN_OUTCOMES as unknown as [string, ...string[]],
)

export const workflowBranchInstanceStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED',
  'WAITING_FOR_ACTIVITIES',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])
export type WorkflowBranchInstanceStatus = z.infer<typeof workflowBranchInstanceStatusSchema>

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

/**
 * Registry-driven: the accepted activity types are whatever the Activity
 * Registry has registered by the time this module loads (the bootstrap import
 * above guarantees the built-ins, INVOKE_AGENT included). Registration order
 * matters — the enum is frozen at this module's first import, so extension
 * modules MUST call `registerActivityType` before anything imports these
 * validators, or their types will be rejected by every schema built from this
 * enum.
 */
export const activityTypeSchema = z.enum(activityTypeIds())
export type ActivityType = z.infer<typeof activityTypeSchema>

export const escalationTriggerSchema = z.enum(['sla_breach', 'no_progress', 'custom'])
export type EscalationTrigger = z.infer<typeof escalationTriggerSchema>

export const escalationActionSchema = z.enum(['reassign', 'notify', 'escalate'])
export type EscalationAction = z.infer<typeof escalationActionSchema>

// ============================================================================
// Task inspector vocabulary (spec §6.1)
// ============================================================================

/**
 * Author-supplied copy that reaches an end user (task instructions, entity
 * binding labels, decision-button labels).
 *
 * The redesign's §6.5 wants the platform localized-string shape
 * (`{ [locale]: string }`) with a bare string treated as the tenant default
 * locale. No such platform type exists, and promoting one to
 * `packages/shared` would mint a new STABLE type surface, so this shape stays
 * LOCAL to workflows until that call is made.
 *
 * Both members are structural, which keeps every existing single-string value
 * valid forever and lets `interpolateVariables` walk either form unchanged (it
 * already recurses into plain objects).
 */
export const taskLocalizedStringSchema = z.union([
  z.string(),
  z.record(z.string(), z.string()),
])
export type TaskLocalizedString = z.infer<typeof taskLocalizedStringSchema>

/**
 * A record the task is about. `idPath` is a context path (the ledger emits
 * `{{context.*}}` pills over the same vocabulary) resolved at task-creation
 * time; `entityType` is the platform entity id (`customers:person`).
 */
export const taskEntityBindingSchema = z.object({
  entityType: z.string().min(1),
  idPath: z.string().min(1),
  label: taskLocalizedStringSchema.optional(),
})
export type TaskEntityBinding = z.infer<typeof taskEntityBindingSchema>

/**
 * What happens when the deadline passes: notify, reassign, or follow the
 * SLA-breach route out of the step.
 */
export const taskOnBreachSchema = z.object({
  action: z.enum(['notify', 'reassign', 'route']),
  reassignTo: z.string().optional(),
  transitionId: z.string().optional(),
})
export type TaskOnBreach = z.infer<typeof taskOnBreachSchema>

/**
 * A decision button, mapped 1:1 to an outgoing route.
 *
 * `transitionId` binds to the transition's DURABLE id, never its index: route
 * order changes with every edit, and both id forms the engine accepts stay
 * valid forever (`t_…` minted by `generateTransitionId()`, plus the legacy
 * `e_<from>_<to>` ids stored definitions still carry), so the shape is an
 * opaque non-empty string rather than a pattern.
 */
export const taskDecisionSchema = z.object({
  id: z.string().min(1),
  label: taskLocalizedStringSchema,
  transitionId: z.string().min(1),
  style: z.enum(['primary', 'secondary', 'destructive']).optional(),
})
export type TaskDecision = z.infer<typeof taskDecisionSchema>

// ============================================================================
// Complex Object Schemas - Workflow Definition Components
// ============================================================================

/**
 * The `user_tasks.assignee_kind` vocabulary, declared here because the AUTHORED
 * config is what decides it and the ORM column merely stores the answer.
 */
export const userTaskAssigneeKindSchema = z.enum(['user', 'customer'])
export type UserTaskAssigneeKind = z.infer<typeof userTaskAssigneeKindSchema>

// User task configuration
export const userTaskConfigSchema = z.object({
  // Support both custom fields array format and JSON Schema format
  formSchema: z.union([
    // Custom format with fields array.
    //
    // `label` is OPTIONAL because every consumer already treats it that way:
    // `lib/task-form-schema.ts` — the single pure mapper behind both form
    // validation and rendering — declares `label?: string` and resolves
    // `title: field.label ?? field.name`, and the editor's own list renders
    // `field.label || field.name`. Requiring it here made the contract
    // stricter than the code reading it, which rejected definitions the
    // engine would have run: the AI draft schema (`lib/ai-authoring.ts`)
    // and the `create_definition` MCP tool both emit an optional label, so
    // a generated definition could 400 on a field the runtime renders fine.
    //
    // This is a WIDENING change — payloads rejected before are accepted now,
    // and nothing previously accepted changes — so it needs no deprecation
    // window. A missing label is an authoring-quality issue, and this module
    // surfaces those through the Problems panel rather than a hard 400.
    z.object({
      fields: z.array(z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        label: z.string().min(1).optional(),
        required: z.boolean().optional(),
        options: z.array(z.any()).optional(),
      }))
    }),
    // JSON Schema format with properties
    z.object({
      type: z.literal('object').optional(),
      properties: z.record(z.string(), z.any()),
      required: z.array(z.string()).optional(),
    }),
  ]).optional(),
  assignedTo: z.union([
    z.string(),
    z.array(z.string()),
  ]).optional(),
  // Role queue the task is offered to when no individual assignee is set. The
  // editor has always written this key (`lib/graph-utils.ts`) and the engine has
  // always read it (`lib/step-handler.ts`), but it was undeclared here — zod
  // strips unknown keys and the definition PUT persists the PARSED value, so
  // authored role assignment was silently discarded on every save.
  assignedToRoles: z.array(z.string()).optional(),
  /**
   * Which principal namespace `assignedTo` names (design §7.1).
   *
   * `'customer'` addresses the task to a PORTAL principal — the resolved id is a
   * `CustomerUser.id`, the row is written with `assignee_kind = 'customer'`, and
   * only `/api/workflows/portal/tasks*` can see or complete it. It is honoured
   * only when an individual assignee resolves, and it forces `assignedToRoles`
   * to null: portal roles are a different namespace and a portal principal
   * cannot claim from a backoffice queue.
   *
   * Absent means `'user'`, which is what every definition authored before this
   * key existed has always meant.
   */
  assigneeKind: userTaskAssigneeKindSchema.optional(),
  // Renderer key for an externally registered task form. Same round-trip as
  // `assignedToRoles`: written by the editor, previously stripped on save.
  formKey: z.string().optional(),
  // Actions offered on the task surface (editor default: complete + cancel).
  allowedActions: z.array(z.string()).optional(),
  assignmentRule: z.string().optional(), // Business rule ID
  slaDuration: z.string().optional(), // ISO 8601 duration
  escalationRules: z.array(z.object({
    trigger: escalationTriggerSchema,
    action: escalationActionSchema,
    escalateTo: z.string().optional(),
    notifyUsers: z.array(z.string()).optional(),
  })).optional(),
  // --------------------------------------------------------------------------
  // Task inspector vocabulary (spec §6.1). Every key below is OPTIONAL and
  // additive: a config declaring none of them parses to exactly what it parsed
  // to before, and the engine reads it exactly as it did before. A regression
  // test in `lib/__tests__/user-task-config.test.ts` pins that byte-for-byte.
  // --------------------------------------------------------------------------
  // "What": rich instructions shown to the assignee, variable pills included.
  instructions: taskLocalizedStringSchema.optional(),
  // "About what": the records this task is about.
  entityBindings: z.array(taskEntityBindingSchema).optional(),
  // "When": priority, deadline, reminders, and what happens on breach.
  priority: taskPrioritySchema.optional(),
  deadline: taskDeadlineSchema.optional(),
  reminders: z.array(taskReminderSchema).optional(),
  onBreach: taskOnBreachSchema.optional(),
  // "Decisions": buttons bound 1:1 to outgoing routes, plus the subset of form
  // fields the assignee may edit before deciding.
  decisions: z.array(taskDecisionSchema).optional(),
  editablePrefilled: z.array(z.string()).optional(),
})
export type UserTaskConfig = z.infer<typeof userTaskConfigSchema>

// Sub-workflow configuration (Phase 8)
export const subWorkflowConfigSchema = z.object({
  subWorkflowId: z.string().min(1, 'Sub-workflow ID is required'),
  version: z.number().int().positive().optional(),
  inputMapping: z.record(z.string(), z.string()).optional(),
  outputMapping: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
})

// Sub-workflow IO contract ("ports"). Business-user-facing typed declaration of
// the inputs a workflow accepts and the outputs it returns. The five port types
// are the simple labels surfaced in the Schema Builder; mapped values are
// coerced and validated against them at the SUB_WORKFLOW boundary by
// lib/port-contract.ts. Declared on the child definition (definition.io).
export const portFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'select', 'date'])

export const portFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Port name must start with a letter and contain only letters, numbers, and underscores'),
  type: portFieldTypeSchema,
  label: z.string().min(1).max(255),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional(),
})

export const workflowIoContractSchema = z.object({
  inputs: z.array(portFieldSchema).optional(),
  outputs: z.array(portFieldSchema).optional(),
})

export type PortFieldType = z.infer<typeof portFieldTypeSchema>
export type PortField = z.infer<typeof portFieldSchema>
export type WorkflowIoContract = z.infer<typeof workflowIoContractSchema>

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

/**
 * Config fields each activity executor requires to run (see
 * `lib/activity-executor.ts`). WAIT is handled separately below because it
 * takes "duration" OR "until" rather than a fixed key set.
 */
const REQUIRED_ACTIVITY_CONFIG_KEYS: Partial<Record<ActivityType, readonly string[]>> = {
  SEND_EMAIL: ['to', 'subject'],
  CALL_API: ['endpoint'],
  CALL_WEBHOOK: ['url'],
  UPDATE_ENTITY: ['commandId', 'input'],
  EMIT_EVENT: ['eventName'],
  EXECUTE_FUNCTION: ['functionName'],
}

// Activity definition (embedded in transitions)
export const activityDefinitionSchema = z.object({
  activityId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Activity ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  activityName: z.string().min(1).max(255),
  activityType: activityTypeSchema,
  config: z.record(z.string(), z.any()),
  async: z.boolean().default(false).optional(), // For Phase 8.3
  retryPolicy: activityRetryPolicySchema.optional(),
  /**
   * Per-activity timeout in milliseconds. This is what the editor writes and
   * what `executeActivity` reads; it was missing from the schema, so
   * `z.object()` stripped it on save and UI-configured timeouts silently did
   * nothing (#4424).
   */
  timeoutMs: z.number().int().positive().optional(),
  /**
   * @deprecated Use `timeoutMs`. Accepted for definitions already stored with
   * an ISO 8601 duration string; the executor normalizes it to milliseconds.
   */
  timeout: z.string().optional(),
  compensation: z.object({
    activityId: z.string().min(1), // ID of compensation activity
    automatic: z.boolean().default(true).optional() // Auto-trigger on failure
  }).optional(), // Compensation configuration (Phase 8.2)
}).superRefine((activity, ctx) => {
  // Config keys each activity executor requires at runtime. Without this, an
  // activity missing e.g. CALL_API's `endpoint` saved cleanly from the visual
  // editor and only failed once an instance ran it — the "edit silently
  // disappeared / nothing told me why" report in #4232 (and the class of bug
  // #4322 was an instance of). Validating here surfaces the exact missing field
  // at edit time, since both the editor's save path and the API route parse
  // through this schema.
  const requiredConfigKeys = REQUIRED_ACTIVITY_CONFIG_KEYS[activity.activityType]
  if (requiredConfigKeys) {
    const config = activity.config || {}
    for (const key of requiredConfigKeys) {
      const value = config[key]
      const isEmpty =
        value == null ||
        (typeof value === 'string' && value.trim() === '') ||
        (key === 'input' && typeof value !== 'object')
      if (isEmpty) {
        ctx.addIssue({
          code: 'custom',
          path: ['config', key],
          message: `${activity.activityType} activity requires "${key}"`,
        })
      }
    }
  }

  if (activity.activityType === 'INVOKE_AGENT') {
    const parsed = invokeAgentConfigSchema.safeParse(activity.config || {})
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['config', ...issue.path],
          message: issue.message,
        })
      }
    }
    return
  }
  if (activity.activityType !== 'WAIT') return
  const config = activity.config || {}
  const hasDuration = config.duration != null && config.duration !== ''
  const hasUntil = config.until != null && config.until !== ''
  if (!hasDuration && !hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: ['config'],
      message: 'WAIT activity requires "duration" or "until"',
    })
    return
  }
  if (hasDuration && hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: ['config'],
      message: 'WAIT activity accepts "duration" OR "until", not both',
    })
    return
  }
  if (hasDuration && !isValidDurationString(config.duration)) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'duration'],
      message: DURATION_ERROR,
    })
  }
  if (hasUntil) {
    if (!isValidIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'until'],
        message: UNTIL_ERROR,
      })
    } else if (!isFutureIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'until'],
        message: UNTIL_PAST_ERROR,
      })
    }
  }
})

// Localized validation message schema (for START step pre-conditions)
export const localizedMessageSchema = z.record(z.string(), z.string())

// START step pre-condition schema (with optional localized validation messages)
export const startPreConditionSchema = z.object({
  ruleId: z.string().min(1).max(50), // Business rule ID
  required: z.boolean().default(true),
  validationMessage: localizedMessageSchema.optional(), // Optional localized error messages
})

export type StartPreCondition = z.infer<typeof startPreConditionSchema>

// WAIT_FOR_CONDITION save-time bounds. Mirrors lib/condition-handler.ts, which
// clamps at runtime; the validator fails closed instead so a definition that
// would degenerate into a plain timer never saves.
export const CONDITION_POLL_INTERVAL_MIN_MS = 5000
export const CONDITION_POLL_INTERVAL_MAX_MS = 3600000

const CONDITION_REQUIRED_ERROR = 'WAIT_FOR_CONDITION step requires a "condition" expression'
const CONDITION_TIMEOUT_REQUIRED_ERROR = 'WAIT_FOR_CONDITION step requires a "timeout" duration'
const CONDITION_ON_TIMEOUT_ERROR = 'WAIT_FOR_CONDITION "onTimeout" must be "FAIL" or "CONTINUE"'
const CONDITION_POLL_INTERVAL_RANGE_ERROR = `WAIT_FOR_CONDITION "pollIntervalMs" must be an integer between ${CONDITION_POLL_INTERVAL_MIN_MS} and ${CONDITION_POLL_INTERVAL_MAX_MS}`
const CONDITION_POLL_INTERVAL_EXCEEDS_TIMEOUT_ERROR =
  'WAIT_FOR_CONDITION "pollIntervalMs" must not exceed "timeout" — the first poll would land after the deadline'

/**
 * Fail-closed save-time validation for a WAIT_FOR_CONDITION step's config.
 * The predicate is checked with the business_rules API validator rather than a
 * hand-rolled shape check, so it inherits that module's safety bounds
 * (nesting depth, rules per group, field-path length, regex linearity).
 */
function refineWaitForConditionStep(config: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const condition = config.condition
  if (condition == null) {
    ctx.addIssue({ code: 'custom', path: ['config', 'condition'], message: CONDITION_REQUIRED_ERROR })
  } else {
    const conditionResult = validateConditionExpressionForApi(condition)
    if (!conditionResult.valid) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'condition'],
        message: conditionResult.error ?? CONDITION_REQUIRED_ERROR,
      })
    }
  }

  const timeout = config.timeout
  const hasTimeout = typeof timeout === 'string' && timeout.length > 0
  if (!hasTimeout) {
    ctx.addIssue({ code: 'custom', path: ['config', 'timeout'], message: CONDITION_TIMEOUT_REQUIRED_ERROR })
  } else if (!isValidDurationString(timeout)) {
    ctx.addIssue({ code: 'custom', path: ['config', 'timeout'], message: DURATION_ERROR })
  }

  if (config.onTimeout != null && config.onTimeout !== 'FAIL' && config.onTimeout !== 'CONTINUE') {
    ctx.addIssue({ code: 'custom', path: ['config', 'onTimeout'], message: CONDITION_ON_TIMEOUT_ERROR })
  }

  if (config.pollIntervalMs == null) return

  const pollIntervalMs = config.pollIntervalMs
  if (
    typeof pollIntervalMs !== 'number'
    || !Number.isInteger(pollIntervalMs)
    || pollIntervalMs < CONDITION_POLL_INTERVAL_MIN_MS
    || pollIntervalMs > CONDITION_POLL_INTERVAL_MAX_MS
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'pollIntervalMs'],
      message: CONDITION_POLL_INTERVAL_RANGE_ERROR,
    })
    return
  }

  if (hasTimeout && isValidDurationString(timeout)) {
    const timeoutMs = parseDuration(timeout)
    if (pollIntervalMs > timeoutMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'pollIntervalMs'],
        message: CONDITION_POLL_INTERVAL_EXCEEDS_TIMEOUT_ERROR,
      })
    }
  }
}

/**
 * Named error directive applied when a failing step has no wired error route
 * (spec 5.9). Absent means `fail`, which is the pre-existing behavior, so no
 * stored definition changes meaning. `fallbackValue` is authored against the
 * step's output contract and lands in the run context under the step id.
 */
export const stepErrorDirectiveSchema = z.object({
  mode: z.enum(['fail', 'continueWithFallback', 'failureQueue']),
  fallbackValue: z.unknown().optional(),
})

export type StepErrorDirective = z.infer<typeof stepErrorDirectiveSchema>

/**
 * Transition discriminator. `error` routes are reachable ONLY from a step
 * failure, `slaBreach` routes ONLY from a user task's deadline passing, and
 * `outcome` routes ONLY from an agent step resolving a disposition (spec 7.2) —
 * normal routing filters all of them out — so adding one never changes the happy
 * path. Absent means `normal`.
 */
export const transitionKindSchema = z.enum(['normal', 'error', 'slaBreach', 'outcome'])

export type WorkflowTransitionKind = z.infer<typeof transitionKindSchema>

/**
 * Definition-level catch-all error handler (spec 5.9). Exactly one form:
 * `workflowId` designates a handler sub-workflow started with
 * `{ failedStepId, error, contextSnapshot }`; `stepId` designates a handler step
 * the run jumps to before failing. Engine construct — never an event trigger.
 */
export const workflowErrorHandlerSchema = z.object({
  workflowId: z.string().min(1).max(100).optional(),
  version: z.number().int().positive().optional(),
  stepId: z.string().min(1).max(100).optional(),
}).superRefine((handler, ctx) => {
  const forms = [handler.workflowId, handler.stepId].filter((value) => value != null && value !== '')
  if (forms.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'errorHandler must declare exactly one of "workflowId" or "stepId"',
    })
  }
  if (handler.version != null && !handler.workflowId) {
    ctx.addIssue({
      code: 'custom',
      path: ['version'],
      message: 'errorHandler.version only applies to the workflowId form',
    })
  }
})

export type WorkflowErrorHandlerConfig = z.infer<typeof workflowErrorHandlerSchema>

// Step definition
export const workflowStepSchema = z.object({
  stepId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Step ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  stepName: z.string().min(1).max(255),
  stepType: workflowStepTypeSchema,
  description: z.string().max(1000).optional(),
  config: z.record(z.string(), z.any()).optional(),
  userTaskConfig: userTaskConfigSchema.optional(),
  subWorkflowConfig: subWorkflowConfigSchema.optional(),
  signalConfig: z.object({
    signalName: z.string().min(1),
    timeout: z.string().optional(),
  }).optional(),
  activities: z.array(activityDefinitionSchema).optional(),
  timeout: z.string().optional(), // ISO 8601 duration
  retryPolicy: retryPolicySchema.optional(),
  // Pre-conditions for START step (business rules to validate before workflow can be started)
  preConditions: z.array(startPreConditionSchema).optional(),
  // What happens when this step fails and no error route is wired (spec 5.9).
  errorDirective: stepErrorDirectiveSchema.optional(),
  // Visual-editor node coordinate persisted in the jsonb definition so a saved
  // graph re-opens exactly as the author arranged it. Additive/optional — legacy
  // and code-authored definitions omit it and auto-arrange on load.
  _editorPosition: z.object({ x: z.number(), y: z.number() }).optional(),
  // Editor-owned, never executed. Holds `unmappedConfig`: config a step-type
  // conversion could not map onto the new type (spec 4.5). The engine ignores
  // this object entirely; it exists so a conversion never destroys authored
  // configuration and a conversion back can recover it.
  metadata: z.record(z.string(), z.any()).optional(),
}).superRefine((step, ctx) => {
  if (step.stepType === 'WAIT_FOR_CONDITION') {
    refineWaitForConditionStep(step.config || {}, ctx)
    return
  }
  if (step.stepType !== 'WAIT_FOR_TIMER') return
  const config = step.config || {}
  const hasDuration = config.duration != null && config.duration !== ''
  const hasUntil = config.until != null && config.until !== ''
  if (!hasDuration && !hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: ['config'],
      message: 'WAIT_FOR_TIMER step requires "duration" or "until"',
    })
    return
  }
  if (hasDuration && hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: ['config'],
      message: 'WAIT_FOR_TIMER step accepts "duration" OR "until", not both',
    })
    return
  }
  if (hasDuration && !isValidDurationString(config.duration)) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'duration'],
      message: DURATION_ERROR,
    })
  }
  if (hasUntil) {
    if (!isValidIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'until'],
        message: UNTIL_ERROR,
      })
    } else if (!isFutureIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'until'],
        message: UNTIL_PAST_ERROR,
      })
    }
  }
})

// Transition condition (reference to business rule)
export const transitionConditionSchema = z.object({
  ruleId: z.string().min(1).max(50), // Business rule ID
  required: z.boolean().default(true),
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
  // Inline condition in the business_rules ConditionExpression language — the
  // one condition language platform-wide. `findValidTransitions` has always
  // evaluated `transition.condition`; declaring it here makes author-time
  // routing (IF_ELSE / SWITCH cases) survive a save round-trip.
  condition: conditionExpressionSchema,
  activities: z.array(activityDefinitionSchema).optional(), // Activities to execute during transition
  continueOnActivityFailure: z.boolean().default(false).optional(), // If true, transition continues even when activities fail
  // Error route marker (spec 5.9). Normal routing never selects an `error`
  // route; the engine follows it only when the source step fails.
  kind: transitionKindSchema.optional(),
  // Which of spec 7.2's five fixed disposition kinds an `outcome` route carries.
  // Additive and optional: a definition declaring no outcome routes never
  // carries it, and an unknown value is surfaced as a Problems-panel issue
  // rather than rejected, so an older definition never fails to load.
  outcomeKind: z.string().min(1).max(50).optional(),
  priority: z.number().int().min(0).max(9999).default(0),
})

// Workflow definition trigger schema (embedded in definition)
// Note: Uses forward reference pattern since eventPatternSchema and eventTriggerConfigSchema are defined later
export const workflowDefinitionTriggerSchema = z.object({
  triggerId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Trigger ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  eventPattern: z.string()
    .min(1, 'Event pattern is required')
    .max(255, 'Event pattern must be at most 255 characters')
    .regex(
      /^(\*|[a-z0-9_]+(\.[a-z0-9_*]+)*)$/i,
      'Event pattern must be "*" or a dot-separated pattern with optional wildcards (e.g., "customers.people.created", "sales.orders.*")'
    ),
  config: z.object({
    filterConditions: z.array(z.object({
      field: z.string().min(1).max(255),
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'exists', 'notExists', 'regex']),
      value: z.any(),
    })).max(20).optional(),
    contextMapping: z.array(z.object({
      targetKey: z.string().min(1).max(100),
      sourceExpression: z.string().min(1).max(255),
      defaultValue: z.any().optional(),
    })).max(50).optional(),
    debounceMs: z.number().int().min(0).max(3600000).optional(),
    maxConcurrentInstances: z.number().int().min(1).max(1000).optional(),
  }).optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(9999).default(0),
})
export type WorkflowDefinitionTrigger = z.infer<typeof workflowDefinitionTriggerSchema>

// ============================================================================
// PARALLEL_FORK / PARALLEL_JOIN definition validation
// ============================================================================

// Error codes surfaced by FORK/JOIN definition validation. Stable identifiers
// so the visual editor and tests can match on them.
export type ForkJoinValidationCode =
  | 'MISSING_JOIN_STEP_ID'
  | 'JOIN_STEP_NOT_FOUND'
  | 'JOIN_STEP_WRONG_TYPE'
  | 'MISSING_FORK_STEP_ID'
  | 'FORK_JOIN_MISMATCH'
  | 'FORK_TOO_FEW_BRANCHES'
  | 'JOIN_TOO_FEW_INCOMING'
  | 'DUPLICATE_BRANCH_KEY'
  | 'NESTED_FORK_NOT_SUPPORTED'
  | 'NO_CONVERGENCE_TO_JOIN'
  | 'FORK_JOIN_CYCLE'
  | 'UNPAIRED_JOIN'

export interface ForkJoinValidationIssue {
  code: ForkJoinValidationCode
  message: string
  stepId?: string
}

interface ForkJoinStepLike {
  stepId: string
  stepType: string
  config?: Record<string, unknown> | null
}

interface ForkJoinTransitionLike {
  transitionId: string
  fromStepId: string
  toStepId: string
  trigger: string
  kind?: string
}

interface ForkJoinDefinitionLike {
  steps: ForkJoinStepLike[]
  transitions: ForkJoinTransitionLike[]
}

/**
 * Validates PARALLEL_FORK / PARALLEL_JOIN structure of a workflow definition.
 * Pure and side-effect-free so it can be unit tested and reused by the editor.
 *
 * Rules (this iteration — wait-all, no nesting):
 *  1. Every FORK declares config.joinStepId pointing at an existing PARALLEL_JOIN.
 *  2. The paired JOIN back-references the fork via config.forkStepId.
 *  3. A FORK has >= 2 outgoing `auto` transitions (branch keys unique); a JOIN has >= 2 incoming.
 *  4. Every path from a FORK converges to its JOIN — no END inside a branch, no dead ends,
 *     no path bypassing the JOIN, no path to a different JOIN.
 *  5. No nesting: no FORK appears on a path between a FORK and its JOIN.
 *  6. No cycles back to the FORK within its branch region.
 *  7. Every PARALLEL_JOIN is paired with exactly one FORK.
 */
export function validateParallelForkJoin(definition: ForkJoinDefinitionLike): ForkJoinValidationIssue[] {
  const issues: ForkJoinValidationIssue[] = []
  const steps = definition.steps ?? []
  // Error routes leave the happy-path graph on purpose (spec 5.9): a branch step
  // may route its failure outside the fork region without breaking convergence.
  const transitions = excludeNonNormalTransitions(definition.transitions ?? [])

  const stepById = new Map<string, ForkJoinStepLike>()
  for (const step of steps) stepById.set(step.stepId, step)

  const outgoingByStep = new Map<string, ForkJoinTransitionLike[]>()
  const incomingCountByStep = new Map<string, number>()
  for (const transition of transitions) {
    const list = outgoingByStep.get(transition.fromStepId) ?? []
    list.push(transition)
    outgoingByStep.set(transition.fromStepId, list)
    incomingCountByStep.set(transition.toStepId, (incomingCountByStep.get(transition.toStepId) ?? 0) + 1)
  }

  const forkSteps = steps.filter((step) => step.stepType === 'PARALLEL_FORK')
  const joinSteps = steps.filter((step) => step.stepType === 'PARALLEL_JOIN')

  // Track which JOIN steps are paired with a FORK so we can flag orphan joins.
  const pairedJoinIds = new Set<string>()

  for (const fork of forkSteps) {
    const joinStepId = (fork.config?.joinStepId as string | undefined) ?? undefined
    if (!joinStepId) {
      issues.push({ code: 'MISSING_JOIN_STEP_ID', stepId: fork.stepId, message: `PARALLEL_FORK "${fork.stepId}" must declare config.joinStepId` })
      continue
    }
    const joinStep = stepById.get(joinStepId)
    if (!joinStep) {
      issues.push({ code: 'JOIN_STEP_NOT_FOUND', stepId: fork.stepId, message: `PARALLEL_FORK "${fork.stepId}" references missing join step "${joinStepId}"` })
      continue
    }
    if (joinStep.stepType !== 'PARALLEL_JOIN') {
      issues.push({ code: 'JOIN_STEP_WRONG_TYPE', stepId: fork.stepId, message: `Step "${joinStepId}" referenced by fork "${fork.stepId}" is not a PARALLEL_JOIN` })
      continue
    }

    pairedJoinIds.add(joinStepId)

    const backForkStepId = (joinStep.config?.forkStepId as string | undefined) ?? undefined
    if (!backForkStepId) {
      issues.push({ code: 'MISSING_FORK_STEP_ID', stepId: joinStepId, message: `PARALLEL_JOIN "${joinStepId}" must declare config.forkStepId` })
    } else if (backForkStepId !== fork.stepId) {
      issues.push({ code: 'FORK_JOIN_MISMATCH', stepId: joinStepId, message: `PARALLEL_JOIN "${joinStepId}" back-reference forkStepId "${backForkStepId}" does not match fork "${fork.stepId}"` })
    }

    const autoBranches = (outgoingByStep.get(fork.stepId) ?? []).filter((transition) => transition.trigger === 'auto')
    if (autoBranches.length < 2) {
      issues.push({ code: 'FORK_TOO_FEW_BRANCHES', stepId: fork.stepId, message: `PARALLEL_FORK "${fork.stepId}" must have at least 2 outgoing auto transitions (found ${autoBranches.length})` })
    }
    const branchKeys = new Set<string>()
    for (const branch of autoBranches) {
      if (branchKeys.has(branch.transitionId)) {
        issues.push({ code: 'DUPLICATE_BRANCH_KEY', stepId: fork.stepId, message: `PARALLEL_FORK "${fork.stepId}" has duplicate branch key "${branch.transitionId}"` })
      }
      branchKeys.add(branch.transitionId)
    }

    if ((incomingCountByStep.get(joinStepId) ?? 0) < 2) {
      issues.push({ code: 'JOIN_TOO_FEW_INCOMING', stepId: joinStepId, message: `PARALLEL_JOIN "${joinStepId}" must have at least 2 incoming transitions` })
    }

    // Convergence + no-nesting + no-cycle traversal over the branch region.
    const fullyExplored = new Set<string>()
    const onStack = new Set<string>()
    let reportedNesting = false
    let reportedNoConvergence = false
    let reportedCycle = false

    const visit = (stepId: string): void => {
      if (stepId === joinStepId) return // converged
      if (stepId === fork.stepId) {
        if (!reportedCycle) {
          issues.push({ code: 'FORK_JOIN_CYCLE', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" loops back to the fork before reaching join "${joinStepId}"` })
          reportedCycle = true
        }
        return
      }
      const step = stepById.get(stepId)
      if (!step) {
        if (!reportedNoConvergence) {
          issues.push({ code: 'NO_CONVERGENCE_TO_JOIN', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" reaches missing step "${stepId}" instead of join "${joinStepId}"` })
          reportedNoConvergence = true
        }
        return
      }
      if (step.stepType === 'END') {
        if (!reportedNoConvergence) {
          issues.push({ code: 'NO_CONVERGENCE_TO_JOIN', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" reaches an END step before join "${joinStepId}"` })
          reportedNoConvergence = true
        }
        return
      }
      if (step.stepType === 'PARALLEL_FORK') {
        if (!reportedNesting) {
          issues.push({ code: 'NESTED_FORK_NOT_SUPPORTED', stepId: fork.stepId, message: `Nested PARALLEL_FORK "${stepId}" inside fork "${fork.stepId}" is not supported` })
          reportedNesting = true
        }
        return
      }
      if (step.stepType === 'PARALLEL_JOIN') {
        // Reached a join that is not this fork's join → it does not converge correctly.
        if (!reportedNoConvergence) {
          issues.push({ code: 'NO_CONVERGENCE_TO_JOIN', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" reaches join "${stepId}" instead of its own join "${joinStepId}"` })
          reportedNoConvergence = true
        }
        return
      }
      if (onStack.has(stepId)) {
        if (!reportedCycle) {
          issues.push({ code: 'FORK_JOIN_CYCLE', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" contains a cycle at step "${stepId}"` })
          reportedCycle = true
        }
        return
      }
      if (fullyExplored.has(stepId)) return

      const outgoing = outgoingByStep.get(stepId) ?? []
      if (outgoing.length === 0) {
        if (!reportedNoConvergence) {
          issues.push({ code: 'NO_CONVERGENCE_TO_JOIN', stepId: fork.stepId, message: `A branch of fork "${fork.stepId}" dead-ends at step "${stepId}" without reaching join "${joinStepId}"` })
          reportedNoConvergence = true
        }
        return
      }
      onStack.add(stepId)
      for (const transition of outgoing) visit(transition.toStepId)
      onStack.delete(stepId)
      fullyExplored.add(stepId)
    }

    for (const branch of autoBranches) visit(branch.toStepId)
  }

  // Any PARALLEL_JOIN not paired with a fork is an orphan.
  for (const join of joinSteps) {
    if (!pairedJoinIds.has(join.stepId)) {
      issues.push({ code: 'UNPAIRED_JOIN', stepId: join.stepId, message: `PARALLEL_JOIN "${join.stepId}" is not paired with any PARALLEL_FORK` })
    }
  }

  return issues
}

// Declared context schema (spec §3.1) — the typed-input contract for a
// definition. Field vocabulary mirrors userTaskConfigSchema's formSchema
// fields so form-driven and context-driven inputs share one shape language.
export const contextSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'select', 'date']),
  label: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
})

export type WorkflowContextSchemaField = z.infer<typeof contextSchemaFieldSchema>

export const contextSchemaSchema = z.object({
  input: z.object({
    fields: z.array(contextSchemaFieldSchema),
  }).optional(),
})

export type WorkflowContextSchema = z.infer<typeof contextSchemaSchema>

// Workflow definition data (JSONB structure)
export const workflowDefinitionDataSchema = z.object({
  steps: z.array(workflowStepSchema).min(2, 'Workflow must have at least START and END steps'),
  transitions: z.array(workflowTransitionSchema).min(1, 'Workflow must have at least one transition'),
  triggers: z.array(workflowDefinitionTriggerSchema).optional(), // Event triggers for automatic workflow start
  contextSchema: contextSchemaSchema.optional(), // Declared typed-input contract (spec §3.1) — canonical input contract
  io: workflowIoContractSchema.optional(), // Sub-workflow input/output port contract; io.input is a read-through alias of contextSchema.input for the ledger
  interpolation: z.enum(['strict', 'lenient']).optional(), // Interpolation mode (spec §3.6): absent = lenient; the POST create route defaults NEW definitions to 'strict' — never default here, it would flip existing lenient definitions on their next full-body update
  errorHandler: workflowErrorHandlerSchema.optional(), // Catch-all error handler (spec §5.9)
  queries: z.array(z.any()).optional(), // For Phase 7
  signals: z.array(z.any()).optional(), // For Phase 9
  timers: z.array(z.any()).optional(), // For Phase 9
}).superRefine((definition, ctx) => {
  for (const issue of validateParallelForkJoin(definition as ForkJoinDefinitionLike)) {
    ctx.addIssue({
      code: 'custom',
      path: ['steps'],
      message: `[${issue.code}] ${issue.message}`,
    })
  }

  // A waiting step with no way out strands the run once its predicate holds,
  // so the graph-level rule the other waiting step types carry applies here too.
  definition.steps.forEach((step, index) => {
    if (step.stepType !== 'WAIT_FOR_CONDITION') return
    const hasOutgoing = definition.transitions.some(
      (transition) => transition.fromStepId === step.stepId,
    )
    if (hasOutgoing) return
    ctx.addIssue({
      code: 'custom',
      path: ['steps', index],
      message: `WAIT_FOR_CONDITION step "${step.stepId}" requires at least one outgoing transition`,
    })
  })
})

// Pinned per-step sample envelope (spec §3.6). Samples are stored verbatim
// with no redaction layer in Phase 2a — the editor surfaces an explicit
// warning where pinning happens instead.
export const sampleEnvelopeSchema = z.object({
  pinnedAt: z.string().datetime({ offset: true }),
  source: z.enum(['manual', 'test']),
  data: z.unknown(),
})

export type WorkflowSampleEnvelopeInput = z.infer<typeof sampleEnvelopeSchema>

export const WORKFLOW_EDITOR_SAMPLES_MAX_CHARS = 65536

export const WORKFLOW_EDITOR_ANNOTATIONS_MAX_CHARS = 65536

// Named START contexts (spec section 8.1). The caps live in the pure
// `lib/start-fixtures.ts` so the editor and the schema cannot disagree.
export const startFixtureSchema = z.object({
  name: z.string().min(1).max(WORKFLOW_START_FIXTURE_NAME_MAX),
  savedAt: z.string().datetime({ offset: true }),
  context: z.record(z.string(), z.any()),
})

export type WorkflowStartFixtureInput = z.infer<typeof startFixtureSchema>

// Editor annotations (spec §4.5): markdown sticky notes and named groups. They
// are documentation only — never execution semantics — which is why they live
// here in metadata and never in `definition.steps`.
const annotationPointSchema = z.object({ x: z.number(), y: z.number() })
const annotationSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() })

export const editorNoteSchema = z.object({
  id: z.string().min(1).max(100),
  markdown: z.string().max(10000),
  position: annotationPointSchema,
  size: annotationSizeSchema,
})

export const editorGroupSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  collapsed: z.boolean().optional(),
})

export const editorAnnotationsSchema = z.object({
  notes: z.array(editorNoteSchema).optional(),
  groups: z.array(editorGroupSchema).optional(),
})

export type WorkflowEditorNoteInput = z.infer<typeof editorNoteSchema>
export type WorkflowEditorGroupInput = z.infer<typeof editorGroupSchema>

// Workflow metadata
export const workflowMetadataSchema = z.object({
  tags: z.array(z.string().max(50)).optional(),
  category: z.string().max(100).optional(),
  icon: z.string().max(100).optional(),
  // Forward-compatibility guard (spec section 5.8): engines below this version
  // refuse to instantiate the definition instead of misexecuting it.
  minEngineVersion: z.number().int().min(1).optional(),
  editor: z.object({
    samples: z.record(z.string(), sampleEnvelopeSchema).optional(),
    annotations: editorAnnotationsSchema.optional(),
    // Named START contexts (spec section 8.1). A different thing from a pinned
    // per-step sample, which is why it gets its own key and its own cap.
    fixtures: z.record(z.string(), startFixtureSchema).optional(),
  }).passthrough().optional(),
}).superRefine((metadata, ctx) => {
  const samples = metadata.editor?.samples
  if (samples && JSON.stringify(samples).length > WORKFLOW_EDITOR_SAMPLES_MAX_CHARS) {
    ctx.addIssue({
      code: 'custom',
      path: ['editor', 'samples'],
      message: `Pinned samples exceed the ${WORKFLOW_EDITOR_SAMPLES_MAX_CHARS}-character limit; unpin or shrink samples before saving`,
    })
  }
  const annotations = metadata.editor?.annotations
  if (annotations && JSON.stringify(annotations).length > WORKFLOW_EDITOR_ANNOTATIONS_MAX_CHARS) {
    ctx.addIssue({
      code: 'custom',
      path: ['editor', 'annotations'],
      message: `Notes and groups exceed the ${WORKFLOW_EDITOR_ANNOTATIONS_MAX_CHARS}-character limit; shorten or remove some before saving`,
    })
  }
  const fixtures = metadata.editor?.fixtures
  if (fixtures && JSON.stringify(fixtures).length > WORKFLOW_START_FIXTURES_MAX_CHARS) {
    ctx.addIssue({
      code: 'custom',
      path: ['editor', 'fixtures'],
      message: `Start fixtures exceed the ${WORKFLOW_START_FIXTURES_MAX_CHARS}-character limit; delete or shrink fixtures before saving`,
    })
  }
  if (fixtures && Object.keys(fixtures).length > WORKFLOW_START_FIXTURES_MAX_COUNT) {
    ctx.addIssue({
      code: 'custom',
      path: ['editor', 'fixtures'],
      message: `A definition may keep at most ${WORKFLOW_START_FIXTURES_MAX_COUNT} start fixtures`,
    })
  }
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

// Definition classification + lifecycle
export const workflowKindSchema = z.enum(['workflow', 'component'])
export const workflowLifecycleSchema = z.enum(['draft', 'published', 'archived'])

export type WorkflowKind = z.infer<typeof workflowKindSchema>
export type WorkflowLifecycle = z.infer<typeof workflowLifecycleSchema>

// A reusable component is invoked only as a SUB_WORKFLOW and never auto-starts,
// so it MUST NOT declare event triggers.
const componentHasNoTriggers = (
  data: { kind?: string | null; definition?: { triggers?: unknown[] } | null },
  ctx: z.RefinementCtx,
) => {
  const triggers = data.definition && (data.definition as { triggers?: unknown[] }).triggers
  if (data.kind === 'component' && Array.isArray(triggers) && triggers.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['definition', 'triggers'],
      message: 'A component workflow cannot declare event triggers',
    })
  }
}

// Full schema for database entities (includes tenant fields)
export const createWorkflowDefinitionSchema = z.object({
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'Workflow ID must contain only lowercase letters, numbers, dots, hyphens, and underscores'),
  workflowName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  version: z.number().int().positive().default(1),
  definition: workflowDefinitionDataSchema,
  metadata: workflowMetadataSchema.optional().nullable(),
  enabled: z.boolean().default(true),
  kind: workflowKindSchema.default('workflow'),
  lifecycle: workflowLifecycleSchema.default('published'),
  effectiveFrom: dateOrNull.optional(),
  effectiveTo: dateOrNull.optional(),
  tenantId: uuid,
  organizationId: uuid,
  createdBy: z.string().max(255).optional().nullable(),
})

export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>

/**
 * The definition's own execution grant (see `lib/definition-grant.ts`).
 *
 * Absent leaves the stored value untouched; `null` or `[]` clears it back to
 * "borrow the starting user's identity". Feature ids only — the subset check
 * against the saving user's own grants happens in the route, because it needs
 * the live RBAC service.
 */
export const workflowGrantedFeaturesSchema = z
  .array(z.string().min(1).max(255))
  .max(200)
  .optional()
  .nullable()

// API input schema (omits tenant fields - injected from auth context)
export const createWorkflowDefinitionInputSchema = z.object({
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'Workflow ID must contain only lowercase letters, numbers, dots, hyphens, and underscores'),
  workflowName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  version: z.number().int().positive().default(1),
  definition: workflowDefinitionDataSchema,
  metadata: workflowMetadataSchema.optional().nullable(),
  enabled: z.boolean().default(true).optional(),
  kind: workflowKindSchema.optional(),
  lifecycle: workflowLifecycleSchema.optional(),
  grantedFeatures: workflowGrantedFeaturesSchema,
})

export type CreateWorkflowDefinitionApiInput = z.infer<typeof createWorkflowDefinitionInputSchema>

// Validation variant that also enforces the component-has-no-triggers rule.
// Kept separate so the base object stays `.pick()`/`.extend()`-able for OpenAPI.
export const createWorkflowDefinitionInputCheckedSchema =
  createWorkflowDefinitionInputSchema.superRefine(componentHasNoTriggers)

export const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial().extend({
  id: uuid,
})

export type UpdateWorkflowDefinitionInput = z.infer<typeof updateWorkflowDefinitionSchema>

// API update schema (omits tenant fields and allows partial updates)
// Accepts the same shape as the create form so the edit page can submit a
// full payload without triggering "Unrecognized keys" validation errors.
// workflowId is accepted but ignored by the route handler (it identifies the
// row); version is applied when supplied so the form can bump it explicitly.
export const updateWorkflowDefinitionInputSchema = z.object({
  workflowId: z.string().min(1).max(100).optional(),
  workflowName: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  version: z.number().int().positive().optional(),
  definition: workflowDefinitionDataSchema.optional(),
  metadata: workflowMetadataSchema.optional().nullable(),
  enabled: z.boolean().optional(),
  kind: workflowKindSchema.optional(),
  lifecycle: workflowLifecycleSchema.optional(),
  effectiveFrom: dateOrNull.optional(),
  effectiveTo: dateOrNull.optional(),
  grantedFeatures: workflowGrantedFeaturesSchema,
}).strict()

export type UpdateWorkflowDefinitionApiInput = z.infer<typeof updateWorkflowDefinitionInputSchema>

// Validation variant that also enforces the component-has-no-triggers rule.
export const updateWorkflowDefinitionInputCheckedSchema =
  updateWorkflowDefinitionInputSchema.superRefine(componentHasNoTriggers)

export const workflowDefinitionFilterSchema = z.object({
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})

export type WorkflowDefinitionFilter = z.infer<typeof workflowDefinitionFilterSchema>

// ============================================================================
// WorkflowDefinitionDraft Schemas
// ============================================================================

/**
 * Lenient shape-only schema for per-user editor drafts (spec §4.7).
 *
 * A draft is autosaved mid-edit and may be structurally incomplete — missing
 * START/END steps, dangling transitions, empty graphs — so it deliberately
 * does NOT reuse workflowDefinitionDataSchema (min counts, fork/join graph
 * rules). Only truly malformed payloads are rejected: steps and transitions
 * must be arrays of objects. Unknown keys (triggers, queries, signals, timers,
 * future fields) pass through untouched so a draft round-trips losslessly.
 * Full validation runs when the draft is promoted via the definition PUT.
 */
export const workflowDefinitionDraftDataSchema = z.object({
  steps: z.array(z.record(z.string(), z.unknown())),
  transitions: z.array(z.record(z.string(), z.unknown())),
}).passthrough()

export type WorkflowDefinitionDraftData = z.infer<typeof workflowDefinitionDraftDataSchema>

export const upsertWorkflowDefinitionDraftInputSchema = z.object({
  definition: workflowDefinitionDraftDataSchema,
  metadata: workflowMetadataSchema.optional().nullable(),
  baseUpdatedAt: dateOrNull.optional(),
}).strict()

export type UpsertWorkflowDefinitionDraftApiInput = z.infer<typeof upsertWorkflowDefinitionDraftInputSchema>

// ============================================================================
// Test-Step (mock-first dry run) Schemas
// ============================================================================

/**
 * Input for POST /definitions/[id]/test-step (spec §3.6). `config` is the raw
 * (possibly still-templated) activity config exactly as the editor holds it;
 * `context` is the caller-supplied sample workflow context the server
 * interpolates against. Both are intentionally shape-only records: per-type
 * config validation is the registry's concern (warnings, not gates), and a
 * sample context is arbitrary user data.
 */
export const testWorkflowStepInputSchema = z.object({
  stepId: z.string().min(1).optional(),
  activityType: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()).default({}),
}).strict()

export type TestWorkflowStepApiInput = z.infer<typeof testWorkflowStepInputSchema>

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
  isDryRun: z.boolean().default(false),
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
  isDryRun: z.boolean().optional(),
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

/**
 * Body of `POST /api/workflows/tasks/[id]/reassign`.
 *
 * The refinement is the point: §6.4 makes a task with no assignee AND no role
 * queue actionable by nobody, so a reassignment that wrote that shape would
 * create the very state reassignment exists to repair. Empty arrays and blank
 * strings are normalized away first, so `{ assignedTo: '  ' }` is refused rather
 * than silently storing whitespace as a user id.
 */
export const reassignUserTaskSchema = z
  .object({
    assignedTo: z
      .string()
      .max(255)
      .nullable()
      .optional()
      .transform((value) => {
        const trimmed = typeof value === 'string' ? value.trim() : ''
        return trimmed.length > 0 ? trimmed : null
      }),
    assignedToRoles: z
      .array(z.string().max(100))
      .nullable()
      .optional()
      .transform((value) => {
        if (!Array.isArray(value)) return null
        const roles = value.map((role) => role.trim()).filter((role) => role.length > 0)
        return roles.length > 0 ? roles : null
      }),
    reason: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .transform((value) => {
        const trimmed = typeof value === 'string' ? value.trim() : ''
        return trimmed.length > 0 ? trimmed : null
      }),
  })
  .refine((value) => value.assignedTo !== null || value.assignedToRoles !== null, {
    message: 'Provide an assignee or at least one role queue',
    path: ['assignedTo'],
  })

export type ReassignUserTaskInput = z.infer<typeof reassignUserTaskSchema>

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
  /**
   * Start the run as a side-effect-free simulation (spec section 8.2). Opting
   * IN is the only way to get one: absent means a real run, exactly as before.
   * The route gates it behind `workflows.definitions.test_run`.
   */
  dryRun: z.boolean().optional(),
  /**
   * Pause before each step so the author can inspect the context and continue
   * or abort (spec section 8.2). Gated by the same `test_run` feature as
   * `dryRun`, and independent of it: a real run can be stepped through too.
   */
  stepThrough: z.boolean().optional(),
})

export type StartWorkflowApiInput = z.infer<typeof startWorkflowInputSchema>

// ============================================================================
// WorkflowEventTrigger Schemas
// ============================================================================

export const triggerFilterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
  'exists',
  'notExists',
  'regex',
])
export type TriggerFilterOperator = z.infer<typeof triggerFilterOperatorSchema>

export const triggerFilterConditionSchema = z.object({
  field: z.string().min(1).max(255, 'Field path must be at most 255 characters'),
  operator: triggerFilterOperatorSchema,
  value: z.any(),
})
export type TriggerFilterCondition = z.infer<typeof triggerFilterConditionSchema>

export const triggerContextMappingSchema = z.object({
  targetKey: z.string().min(1).max(100, 'Target key must be at most 100 characters'),
  sourceExpression: z.string().min(1).max(255, 'Source expression must be at most 255 characters'),
  defaultValue: z.any().optional(),
})
export type TriggerContextMapping = z.infer<typeof triggerContextMappingSchema>

export const eventTriggerConfigSchema = z.object({
  filterConditions: z.array(triggerFilterConditionSchema).max(20, 'Maximum 20 filter conditions allowed').optional(),
  contextMapping: z.array(triggerContextMappingSchema).max(50, 'Maximum 50 context mappings allowed').optional(),
  debounceMs: z.number().int().min(0).max(3600000, 'Debounce cannot exceed 1 hour').optional(),
  maxConcurrentInstances: z.number().int().min(1).max(1000, 'Max concurrent instances must be between 1 and 1000').optional(),
})
export type EventTriggerConfig = z.infer<typeof eventTriggerConfigSchema>

export const eventPatternSchema = z.string()
  .min(1, 'Event pattern is required')
  .max(255, 'Event pattern must be at most 255 characters')
  .regex(
    /^(\*|[a-z0-9_]+(\.[a-z0-9_*]+)*)$/i,
    'Event pattern must be "*" or a dot-separated pattern with optional wildcards (e.g., "customers.people.created", "sales.orders.*")'
  )

export const createEventTriggerSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  workflowDefinitionId: uuid,
  eventPattern: eventPatternSchema,
  config: eventTriggerConfigSchema.optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(9999).default(0),
  tenantId: uuid,
  organizationId: uuid,
  createdBy: z.string().max(255).optional().nullable(),
})
export type CreateEventTriggerInput = z.infer<typeof createEventTriggerSchema>

// API input schema (omits tenant fields - injected from auth context)
export const createEventTriggerInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  workflowDefinitionId: uuid,
  eventPattern: eventPatternSchema,
  config: eventTriggerConfigSchema.optional().nullable(),
  enabled: z.boolean().default(true).optional(),
  priority: z.number().int().min(0).max(9999).default(0).optional(),
})
export type CreateEventTriggerApiInput = z.infer<typeof createEventTriggerInputSchema>

export const updateEventTriggerSchema = createEventTriggerSchema.partial().extend({
  id: uuid,
})
export type UpdateEventTriggerInput = z.infer<typeof updateEventTriggerSchema>

// API update schema (omits tenant fields and allows partial updates)
export const updateEventTriggerInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  workflowDefinitionId: uuid.optional(),
  eventPattern: eventPatternSchema.optional(),
  config: eventTriggerConfigSchema.optional().nullable(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
}).strict()
export type UpdateEventTriggerApiInput = z.infer<typeof updateEventTriggerInputSchema>

export const eventTriggerFilterSchema = z.object({
  name: z.string().optional(),
  workflowDefinitionId: uuid.optional(),
  eventPattern: z.string().optional(),
  enabled: z.boolean().optional(),
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
})
export type EventTriggerFilter = z.infer<typeof eventTriggerFilterSchema>
