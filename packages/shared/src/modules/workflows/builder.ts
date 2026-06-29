/**
 * Code-Based Workflow Definitions — Builder API
 *
 * Provides compile-time type safety for step IDs in transitions.
 * The `const` modifier on TSteps tells TypeScript to infer literal types
 * for stepId values. Transitions constrain fromStepId/toStepId to this union.
 *
 * @example
 * ```typescript
 * const workflow = defineWorkflow({
 *   workflowId: 'sales.order-approval',
 *   workflowName: 'Order Approval',
 *   steps: [
 *     { stepId: 'start', stepName: 'Start', stepType: 'START' },
 *     { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
 *     { stepId: 'end', stepName: 'End', stepType: 'END' },
 *   ] as const,
 *   transitions: [
 *     { transitionId: 'to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
 *     // Compile error: '"typo"' is not assignable to '"start" | "review" | "end"'
 *     // { transitionId: 'bad', fromStepId: 'typo', toStepId: 'end', trigger: 'auto' },
 *   ],
 * })
 * ```
 */

import type {
  CodeWorkflowDefinition,
  CodeStepDefinition,
  CodeTransitionDefinition,
  CodeTriggerDefinition,
  CodeActivityDefinition,
  WorkflowStepType,
  TransitionTrigger,
} from './types'

// ============================================================================
// Builder Config Type (with const generic for type inference)
// ============================================================================

interface WorkflowBuilderConfig<TSteps extends readonly StepInput<string>[]> {
  workflowId: string
  workflowName: string
  description?: string
  version?: number
  enabled?: boolean
  metadata?: { tags?: string[]; category?: string; icon?: string }
  steps: TSteps
  transitions: TransitionInput<TSteps[number]['stepId']>[]
  triggers?: CodeTriggerDefinition[]
}

interface StepInput<TStepId extends string> {
  stepId: TStepId
  stepName: string
  stepType: WorkflowStepType
  description?: string
  config?: Record<string, unknown>
  userTaskConfig?: CodeStepDefinition['userTaskConfig']
  subWorkflowConfig?: CodeStepDefinition['subWorkflowConfig']
  signalConfig?: CodeStepDefinition['signalConfig']
  activities?: CodeActivityDefinition[]
  timeout?: string
  retryPolicy?: { maxAttempts: number; backoffMs: number }
  preConditions?: CodeStepDefinition['preConditions']
}

interface TransitionInput<TStepId extends string> {
  transitionId: string
  fromStepId: TStepId
  toStepId: TStepId
  transitionName?: string
  trigger: TransitionTrigger
  preConditions?: CodeTransitionDefinition['preConditions']
  postConditions?: CodeTransitionDefinition['postConditions']
  activities?: CodeActivityDefinition[]
  continueOnActivityFailure?: boolean
  priority?: number
}

// ============================================================================
// defineWorkflow — Main Builder Function
// ============================================================================

/**
 * Define a code-based workflow with compile-time step ID safety.
 *
 * Use `as const` on the steps array for full type inference:
 * ```typescript
 * defineWorkflow({
 *   steps: [...] as const,
 *   transitions: [...], // fromStepId/toStepId auto-constrained
 * })
 * ```
 *
 * The returned `CodeWorkflowDefinition` has `moduleId` set to empty string.
 * The generator sets the correct `moduleId` at registration time.
 */
export function defineWorkflow<const TSteps extends readonly StepInput<string>[]>(
  config: WorkflowBuilderConfig<TSteps>,
): CodeWorkflowDefinition {
  const steps: CodeStepDefinition[] = config.steps.map((step) => ({
    stepId: step.stepId,
    stepName: step.stepName,
    stepType: step.stepType,
    ...(step.description !== undefined && { description: step.description }),
    ...(step.config !== undefined && { config: step.config }),
    ...(step.userTaskConfig !== undefined && { userTaskConfig: step.userTaskConfig }),
    ...(step.subWorkflowConfig !== undefined && { subWorkflowConfig: step.subWorkflowConfig }),
    ...(step.signalConfig !== undefined && { signalConfig: step.signalConfig }),
    ...(step.activities !== undefined && { activities: step.activities }),
    ...(step.timeout !== undefined && { timeout: step.timeout }),
    ...(step.retryPolicy !== undefined && { retryPolicy: step.retryPolicy }),
    ...(step.preConditions !== undefined && { preConditions: step.preConditions }),
  }))

  const transitions: CodeTransitionDefinition[] = config.transitions.map((t) => ({
    transitionId: t.transitionId,
    fromStepId: t.fromStepId,
    toStepId: t.toStepId,
    trigger: t.trigger,
    ...(t.transitionName !== undefined && { transitionName: t.transitionName }),
    ...(t.preConditions !== undefined && { preConditions: t.preConditions }),
    ...(t.postConditions !== undefined && { postConditions: t.postConditions }),
    ...(t.activities !== undefined && { activities: t.activities }),
    ...(t.continueOnActivityFailure !== undefined && { continueOnActivityFailure: t.continueOnActivityFailure }),
    ...(t.priority !== undefined && { priority: t.priority }),
  }))

  return {
    workflowId: config.workflowId,
    workflowName: config.workflowName,
    description: config.description ?? null,
    version: config.version ?? 1,
    enabled: config.enabled ?? true,
    metadata: config.metadata ?? null,
    definition: {
      steps,
      transitions,
      ...(config.triggers !== undefined && { triggers: config.triggers }),
    },
    moduleId: '', // Set by generator/factory at registration time
  }
}
