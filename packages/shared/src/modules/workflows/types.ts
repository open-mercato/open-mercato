/**
 * Code-Based Workflow Definitions — Shared Types
 *
 * These types are used by the builder API, generator extension, and in-memory registry.
 * They mirror the JSONB shape stored in workflow_definitions.definition but add
 * generic type safety for step ID references in transitions.
 *
 * The engine's zod schemas (`@open-mercato/core/modules/workflows/data/validators`)
 * are the source of truth. This package cannot import them, so the step-type union
 * and `userTaskConfig` are mirrored by hand and guarded against drift by
 * `code-definition-types.typecheck.tsx` and `code-definition-types-parity.test.ts`
 * in the core workflows module.
 */

// ============================================================================
// Step Types
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
  | 'WAIT_FOR_CONDITION'
  | 'IF_ELSE'
  | 'SWITCH'

export type TransitionTrigger = 'auto' | 'manual' | 'signal' | 'timer'

export type ActivityType =
  | 'SEND_EMAIL'
  | 'CALL_API'
  | 'UPDATE_ENTITY'
  | 'EMIT_EVENT'
  | 'CALL_WEBHOOK'
  | 'EXECUTE_FUNCTION'
  | 'WAIT'

// ============================================================================
// Activity Definition
// ============================================================================

export interface CodeActivityDefinition {
  activityId: string
  activityName: string
  activityType: ActivityType
  config: Record<string, unknown>
  async?: boolean
  retryPolicy?: {
    maxAttempts: number
    initialIntervalMs: number
    backoffCoefficient: number
    maxIntervalMs: number
  }
  timeout?: string
  compensation?: {
    activityId: string
    automatic?: boolean
  }
}

// ============================================================================
// Step Definition (generic over step IDs)
// ============================================================================

export interface CodeStepDefinition<TStepId extends string = string> {
  stepId: TStepId
  stepName: string
  stepType: WorkflowStepType
  description?: string
  config?: Record<string, unknown>
  userTaskConfig?: {
    formSchema?: Record<string, unknown>
    assignedTo?: string | string[]
    assignmentRule?: string
    slaDuration?: string
    escalationRules?: Array<{
      trigger: 'sla_breach' | 'no_progress' | 'custom'
      action: 'reassign' | 'notify' | 'escalate'
      escalateTo?: string
      notifyUsers?: string[]
    }>
    assignedToRoles?: string[]
    assigneeKind?: 'user' | 'customer'
    formKey?: string
    allowedActions?: string[]
    instructions?: string | Record<string, string>
    entityBindings?: Array<{
      entityType: string
      idPath: string
      label?: string | Record<string, string>
    }>
    priority?: 'low' | 'medium' | 'high' | 'extreme'
    deadline?: {
      duration: string
    }
    reminders?: Array<{
      offset: string
    }>
    onBreach?: {
      action: 'notify' | 'reassign' | 'route'
      reassignTo?: string
      transitionId?: string
    }
    decisions?: Array<{
      id: string
      label: string | Record<string, string>
      transitionId: string
      style?: 'primary' | 'secondary' | 'destructive'
    }>
    editablePrefilled?: string[]
  }
  subWorkflowConfig?: {
    subWorkflowId: string
    version?: number
    inputMapping?: Record<string, string>
    outputMapping?: Record<string, string>
    timeoutMs?: number
  }
  signalConfig?: {
    signalName: string
    timeout?: string
  }
  activities?: CodeActivityDefinition[]
  timeout?: string
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  }
  preConditions?: Array<{
    ruleId: string
    required?: boolean
    validationMessage?: Record<string, string>
  }>
}

// ============================================================================
// Transition Definition (generic over step IDs)
// ============================================================================

export interface CodeTransitionDefinition<TStepId extends string = string> {
  transitionId: string
  fromStepId: TStepId
  toStepId: TStepId
  transitionName?: string
  trigger: TransitionTrigger
  preConditions?: Array<{
    ruleId: string
    required?: boolean
  }>
  postConditions?: Array<{
    ruleId: string
    required?: boolean
  }>
  activities?: CodeActivityDefinition[]
  continueOnActivityFailure?: boolean
  priority?: number
}

// ============================================================================
// Trigger Definition
// ============================================================================

export interface CodeTriggerDefinition {
  triggerId: string
  name: string
  description?: string | null
  eventPattern: string
  config?: {
    filterConditions?: Array<{
      field: string
      operator: string
      value: unknown
    }>
    contextMapping?: Array<{
      targetKey: string
      sourceExpression: string
      defaultValue?: unknown
    }>
    debounceMs?: number
    maxConcurrentInstances?: number
    entityType?: string
  } | null
  enabled: boolean
  priority: number
}

// ============================================================================
// Workflow Definition Data (matches JSONB shape)
// ============================================================================

export interface CodeWorkflowDefinitionData {
  steps: CodeStepDefinition[]
  transitions: CodeTransitionDefinition[]
  triggers?: CodeTriggerDefinition[]
  queries?: unknown[]
  signals?: unknown[]
  timers?: unknown[]
}

// ============================================================================
// Code Workflow Definition (output of defineWorkflow)
// ============================================================================

export interface CodeWorkflowDefinition {
  workflowId: string
  workflowName: string
  description: string | null
  version: number
  enabled: boolean
  metadata: { tags?: string[]; category?: string; icon?: string } | null
  definition: CodeWorkflowDefinitionData
  moduleId: string
}

// ============================================================================
// Module Config (for generator discovery)
// ============================================================================

export interface WorkflowsModuleConfig {
  moduleId: string
  workflows: CodeWorkflowDefinition[]
}
