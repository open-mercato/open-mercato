import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  createWorkflowsModuleConfig,
  defineWorkflow,
} from '@open-mercato/shared/modules/workflows'
import { registerTaskCompletionGuards } from '@open-mercato/core/modules/workflows/lib/task-completion-guards'

const todoCreatedReference = defineWorkflow({
  workflowId: 'example.todo-created-reference',
  workflowName: 'Example Todo Created Reference',
  description: 'A minimal code workflow started by the typed Todo creation event.',
  metadata: {
    category: 'Example',
    tags: ['example', 'todo', 'reference'],
    icon: 'check-square',
  },
  steps: [
    {
      stepId: 'start',
      stepName: 'Todo created',
      stepType: 'START',
      description: 'Receive the scoped Todo creation event.',
    },
    {
      stepId: 'end',
      stepName: 'Complete',
      stepType: 'END',
      description: 'Finish without external calls or credentials.',
    },
  ] as const,
  transitions: [
    {
      transitionId: 'complete-reference',
      transitionName: 'Complete reference workflow',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
    },
  ],
  triggers: [
    {
      triggerId: 'example-todo-created',
      name: 'Example Todo Created',
      description: 'Starts once for each scoped example.todo.created event delivery.',
      eventPattern: 'example.todo.created',
      config: {
        entityType: 'example:todo',
        contextMapping: [
          { targetKey: 'todoId', sourceExpression: 'id' },
        ],
      },
      enabled: true,
      priority: 100,
    },
  ],
})

/**
 * Test-only fixture for TC-WF-070 (task completion guards, #7178).
 *
 * Registers nothing unless the integration runner exported
 * `OM_INTEGRATION_TEST=true`, so development and production never carry a
 * completion veto. Each guard selects on a `formKey` only the spec authors,
 * so no other task in the shared test database is affected:
 *
 * - `example.tc_wf_070.veto` — refuses with its own code and message key;
 * - `example.tc_wf_070.pass` — allows;
 * - `example.tc_wf_070.throw` — throws, which MUST fail closed.
 */
export const EXAMPLE_COMPLETION_GUARD_FORM_KEYS = {
  veto: 'example.tc_wf_070.veto',
  pass: 'example.tc_wf_070.pass',
  throw: 'example.tc_wf_070.throw',
} as const

if (parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)) {
  registerTaskCompletionGuards([
    {
      moduleId: 'example',
      guards: [
        {
          id: 'example.tc_wf_070.veto',
          formKey: EXAMPLE_COMPLETION_GUARD_FORM_KEYS.veto,
          evaluate: () => ({
            ok: false,
            code: 'EXAMPLE_PRECONDITION_NOT_MET',
            messageKey: 'example.workflows.completionGuard.vetoed',
            message: 'The example precondition is not met',
          }),
        },
        {
          id: 'example.tc_wf_070.pass',
          formKey: EXAMPLE_COMPLETION_GUARD_FORM_KEYS.pass,
          evaluate: () => ({ ok: true }),
        },
        {
          id: 'example.tc_wf_070.throw',
          formKey: EXAMPLE_COMPLETION_GUARD_FORM_KEYS.throw,
          evaluate: () => {
            throw new Error('[internal] example completion guard failure')
          },
        },
      ],
    },
  ])
}

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'example',
  workflows: [todoCreatedReference],
})

export default workflowsConfig

