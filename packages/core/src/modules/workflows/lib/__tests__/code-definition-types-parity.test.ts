/**
 * Runtime half of the drift guard between the engine's zod schemas and the
 * code-definition types `defineWorkflow` accepts (#7183). The type-level half is
 * `data/code-definition-types.typecheck.tsx`; this test runs in Jest, where type
 * diagnostics are off, so it compares the schemas' RUNTIME key sets against an
 * exhaustive list typed against the code definition.
 *
 * When it fails, the engine gained a step type or a `userTaskConfig` key: add it to
 * `packages/shared/src/modules/workflows/types.ts` (optional key / union member
 * only) and to the matching list below.
 */
import { defineWorkflow } from '@open-mercato/shared/modules/workflows'
import type { CodeStepDefinition, WorkflowStepType } from '@open-mercato/shared/modules/workflows'
import { userTaskConfigSchema, workflowStepSchema, workflowStepTypeSchema } from '../../data/validators'

type CodeUserTaskConfig = NonNullable<CodeStepDefinition['userTaskConfig']>

const codeUserTaskConfigKeys = {
  formSchema: true,
  assignedTo: true,
  assignedToRoles: true,
  assigneeKind: true,
  formKey: true,
  allowedActions: true,
  assignmentRule: true,
  slaDuration: true,
  escalationRules: true,
  instructions: true,
  entityBindings: true,
  priority: true,
  deadline: true,
  reminders: true,
  onBreach: true,
  decisions: true,
  editablePrefilled: true,
} satisfies Record<keyof CodeUserTaskConfig, true>

const codeStepTypes = {
  START: true,
  END: true,
  USER_TASK: true,
  AUTOMATED: true,
  PARALLEL_FORK: true,
  PARALLEL_JOIN: true,
  SUB_WORKFLOW: true,
  WAIT_FOR_SIGNAL: true,
  WAIT_FOR_TIMER: true,
  WAIT_FOR_CONDITION: true,
  IF_ELSE: true,
  SWITCH: true,
} satisfies Record<WorkflowStepType, true>

describe('code-definition types stay in step with the engine schemas (#7183)', () => {
  it('declares every userTaskConfig key the engine accepts, and no other', () => {
    expect(Object.keys(codeUserTaskConfigKeys).sort()).toEqual(Object.keys(userTaskConfigSchema.shape).sort())
  })

  it('declares every step type the engine accepts, and no other', () => {
    expect(Object.keys(codeStepTypes).sort()).toEqual([...workflowStepTypeSchema.options].sort())
  })

  it('produces steps the engine validates, including WAIT_FOR_CONDITION and the full user-task vocabulary', () => {
    const workflow = defineWorkflow({
      workflowId: 'core.code-definition-parity',
      workflowName: 'Code definition parity',
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved' }] },
            assignedTo: 'user-1',
            assignedToRoles: ['reviewer'],
            assigneeKind: 'user',
            formKey: 'sales.review',
            allowedActions: ['complete', 'cancel'],
            assignmentRule: 'rule-1',
            slaDuration: 'P1D',
            escalationRules: [{ trigger: 'sla_breach', action: 'notify', notifyUsers: ['user-2'] }],
            instructions: { en: 'Review the order' },
            entityBindings: [{ entityType: 'sales:order', idPath: 'context.orderId', label: 'Order' }],
            priority: 'high',
            deadline: { duration: 'P2D' },
            reminders: [{ offset: 'PT4H' }],
            onBreach: { action: 'route', transitionId: 'review_to_end' },
            decisions: [{ id: 'approve', label: 'Approve', transitionId: 'review_to_wait', style: 'primary' }],
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
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ] as const,
      transitions: [
        { transitionId: 'start_to_review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review_to_wait', fromStepId: 'review', toStepId: 'wait', trigger: 'manual' },
        { transitionId: 'review_to_end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
        { transitionId: 'wait_to_end', fromStepId: 'wait', toStepId: 'end', trigger: 'auto' },
      ],
    })

    for (const step of workflow.definition.steps) {
      const parsed = workflowStepSchema.safeParse(step)
      expect(parsed.error?.issues ?? []).toEqual([])
      expect(parsed.data).toEqual(step)
    }
  })
})
