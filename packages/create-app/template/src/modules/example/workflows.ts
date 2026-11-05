import {
  createWorkflowsModuleConfig,
  defineWorkflow,
} from '@open-mercato/shared/modules/workflows'

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

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'example',
  workflows: [todoCreatedReference],
})

export default workflowsConfig

