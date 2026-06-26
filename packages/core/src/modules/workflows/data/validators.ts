import { z } from 'zod'
import { parseDuration } from '../lib/duration'

/**
 * Workflows Module - Zod Validators
 *
 * Comprehensive validation schemas for workflow engine entities.
 */

const uuid = z.uuid()

// Variable interpolation tokens (e.g., {{context.timeout}}) are resolved at
// run time, so we must skip strict syntax checks on them at save time.
const containsTemplate = (value: string) => value.includes('{{')

export function isValidDurationString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  try {
    const ms = parseDuration(value)
    return Number.isFinite(ms) && ms > 0
  } catch {
    return false
  }
}

export function isValidIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}

export function isFutureIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() > Date.now()
}

const DURATION_ERROR = 'Invalid duration. Use ISO 8601 (e.g., PT5M, PT1H, P1D) or simple format (5m, 1h, 3d)'
const UNTIL_ERROR = 'Invalid "until". Provide an ISO 8601 datetime string'
const UNTIL_PAST_ERROR = '"until" must be a future datetime'

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
  'WAITING_FOR_ACTIVITIES',
  'FORKED',
])
export type WorkflowInstanceStatus = z.infer<typeof workflowInstanceStatusSchema>

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

export const activityTypeSchema = z.enum([
  'SEND_EMAIL',
  'CALL_API',
  'UPDATE_ENTITY',
  'EMIT_EVENT',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
  'INVOKE_AGENT',
])
export type ActivityType = z.infer<typeof activityTypeSchema>

// INVOKE_AGENT activity configuration — runs a callable agent (area 02a) and
// dispositions any actionable proposal. `onResult` is carried verbatim to the
// agent_orchestrator disposition service.
export const invokeAgentConfigSchema = z.object({
  agentId: z.string().min(1),
  input: z.record(z.string(), z.any()).default({}),
  onResult: z.union([
    z.object({ autoApproveThreshold: z.number().min(0).max(1) }),
    z.object({ alwaysAsk: z.literal(true) }),
  ]),
})
export type InvokeAgentConfig = z.infer<typeof invokeAgentConfigSchema>

export const escalationTriggerSchema = z.enum(['sla_breach', 'no_progress', 'custom'])
export type EscalationTrigger = z.infer<typeof escalationTriggerSchema>

export const escalationActionSchema = z.enum(['reassign', 'notify', 'escalate'])
export type EscalationAction = z.infer<typeof escalationActionSchema>

// ============================================================================
// Complex Object Schemas - Workflow Definition Components
// ============================================================================

// User task configuration
export const userTaskConfigSchema = z.object({
  // Support both custom fields array format and JSON Schema format
  formSchema: z.union([
    // Custom format with fields array
    z.object({
      fields: z.array(z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        label: z.string().min(1),
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

// CALL_API activity configuration
export const callApiConfigSchema = z.object({
  endpoint: z.string().min(1, 'API endpoint is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
  validateTenantMatch: z.boolean().default(true).optional(),
  timeout: z.number().int().positive().optional(),
})

export const callWebhookConfigSchema = z.object({
  url: z.string().min(1, 'Webhook URL is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
})
export type CallWebhookConfig = z.infer<typeof callWebhookConfigSchema>

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

// Activity definition (embedded in transitions)
export const activityDefinitionSchema = z.object({
  activityId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'Activity ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  activityName: z.string().min(1).max(255),
  activityType: activityTypeSchema,
  config: z.record(z.string(), z.any()),
  async: z.boolean().default(false).optional(), // For Phase 8.3
  retryPolicy: activityRetryPolicySchema.optional(),
  timeout: z.string().optional(), // ISO 8601 duration
  compensation: z.object({
    activityId: z.string().min(1), // ID of compensation activity
    automatic: z.boolean().default(true).optional() // Auto-trigger on failure
  }).optional(), // Compensation configuration (Phase 8.2)
}).superRefine((activity, ctx) => {
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
}).superRefine((step, ctx) => {
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
  activities: z.array(activityDefinitionSchema).optional(), // Activities to execute during transition
  continueOnActivityFailure: z.boolean().default(false).optional(), // If true, transition continues even when activities fail
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
  const transitions = definition.transitions ?? []

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

// Workflow definition data (JSONB structure)
export const workflowDefinitionDataSchema = z.object({
  steps: z.array(workflowStepSchema).min(2, 'Workflow must have at least START and END steps'),
  transitions: z.array(workflowTransitionSchema).min(1, 'Workflow must have at least one transition'),
  triggers: z.array(workflowDefinitionTriggerSchema).optional(), // Event triggers for automatic workflow start
  io: workflowIoContractSchema.optional(), // Sub-workflow input/output port contract
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
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'Workflow ID must contain only lowercase letters, numbers, dots, hyphens, and underscores'),
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
  workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'Workflow ID must contain only lowercase letters, numbers, dots, hyphens, and underscores'),
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
  effectiveFrom: dateOrNull.optional(),
  effectiveTo: dateOrNull.optional(),
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
