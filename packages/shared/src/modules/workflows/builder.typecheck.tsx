// Compile-time-only guard for the code-definition types (#7183). Never imported at
// runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch a
// regression here, because this repo's Jest transform runs with
// `isolatedModules: true` and therefore skips type diagnostics.
//
// It sits outside `__tests__` because `packages/shared/tsconfig.json` excludes that
// directory from `tsc --noEmit`, and it is a `.tsx` for the same mutation-gate reason
// as `lib/i18n/config.typecheck.tsx`.
//
// What it protects: every step type and every `userTaskConfig` key the workflows
// engine validates must compile in `defineWorkflow` without a cast. The engine side
// of the contract (drift against `userTaskConfigSchema` / `workflowStepTypeSchema`)
// is guarded in `packages/core/src/modules/workflows/data/code-definition-types.typecheck.tsx`.
import { defineWorkflow } from './builder'
import type { CodeStepDefinition, WorkflowStepType } from './types'

type UserTaskConfig = NonNullable<CodeStepDefinition['userTaskConfig']>

// 1. Every engine-supported user-task key, in one USER_TASK step, plus the
//    condition-wait and branching step types, compiles in the builder.
const everyEngineFeature = defineWorkflow({
  workflowId: 'shared.typecheck-engine-parity',
  workflowName: 'Engine parity',
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    {
      stepId: 'review',
      stepName: 'Review',
      stepType: 'USER_TASK',
      userTaskConfig: {
        formSchema: { fields: [{ name: 'approved', type: 'boolean' }] },
        assignedTo: 'user-1',
        assignedToRoles: ['reviewer'],
        assigneeKind: 'user',
        formKey: 'sales.review',
        allowedActions: ['complete', 'cancel'],
        assignmentRule: 'rule-1',
        slaDuration: 'P1D',
        escalationRules: [{ trigger: 'sla_breach', action: 'notify', notifyUsers: ['user-2'] }],
        instructions: { en: 'Review {{context.orderId}}', pl: 'Sprawdź {{context.orderId}}' },
        entityBindings: [{ entityType: 'sales:order', idPath: 'context.orderId', label: 'Order' }],
        priority: 'high',
        deadline: { duration: 'P2D' },
        reminders: [{ offset: 'PT4H' }],
        onBreach: { action: 'route', transitionId: 'review_to_end' },
        decisions: [
          { id: 'approve', label: 'Approve', transitionId: 'review_to_wait', style: 'primary' },
          { id: 'reject', label: { en: 'Reject' }, transitionId: 'review_to_end', style: 'destructive' },
        ],
        editablePrefilled: ['approved'],
      },
    },
    {
      stepId: 'wait',
      stepName: 'Wait for payment',
      stepType: 'WAIT_FOR_CONDITION',
      config: {
        condition: { operator: 'AND', rules: [{ field: 'payment.status', operator: '==', value: 'captured' }] },
        timeout: 'P1D',
        onTimeout: 'FAIL',
      },
    },
    { stepId: 'branch', stepName: 'Branch', stepType: 'IF_ELSE' },
    { stepId: 'route', stepName: 'Route', stepType: 'SWITCH' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ] as const,
  transitions: [
    { transitionId: 'start_to_review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
    { transitionId: 'review_to_wait', fromStepId: 'review', toStepId: 'wait', trigger: 'manual' },
    { transitionId: 'review_to_end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
    { transitionId: 'wait_to_end', fromStepId: 'wait', toStepId: 'end', trigger: 'auto' },
  ],
})

// 2. The new step types are members of the exported union.
const newStepTypes: WorkflowStepType[] = ['WAIT_FOR_CONDITION', 'IF_ELSE', 'SWITCH']

// 3. Pre-existing keys keep their original (wide) types — nothing was narrowed.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const formSchemaStaysWide: MutuallyAssignable<UserTaskConfig['formSchema'], Record<string, unknown> | undefined> = true
const assignedToStaysWide: MutuallyAssignable<UserTaskConfig['assignedTo'], string | string[] | undefined> = true

// 4. The new keys are still checked, not `unknown`.
// @ts-expect-error 'urgent' is not an engine priority
const badPriority: UserTaskConfig = { priority: 'urgent' }
// @ts-expect-error a decision must name the transition it routes to
const decisionWithoutRoute: UserTaskConfig = { decisions: [{ id: 'approve', label: 'Approve' }] }
// @ts-expect-error 'WAIT_FOR_EVENT' is not an engine step type
const unknownStepType: WorkflowStepType = 'WAIT_FOR_EVENT'

void everyEngineFeature
void newStepTypes
void formSchemaStaysWide
void assignedToStaysWide
void badPriority
void decisionWithoutRoute
void unknownStepType
