import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  createWorkflowsModuleConfig,
  defineWorkflow,
} from '@open-mercato/shared/modules/workflows'
import {
  registerTaskEntityAclRequirements,
  registerTaskEntityLinkBuilders,
} from '@open-mercato/core/modules/workflows/lib/task-entity-registry'

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
 * Test-only fixture for TC-WF-068 (task entity registration seam, #7180).
 *
 * Registers nothing unless the integration runner exported
 * `OM_INTEGRATION_TEST=true`, so development and production keep the default
 * fail-closed behaviour for app-owned task entity types. Under the runner it
 * registers:
 *
 * - `example:todo` — view requirement plus a same-origin deep link;
 * - `example:example_item` — view requirement plus a link builder that answers
 *   an off-origin URL, which the server MUST drop.
 *
 * `example:example_customer_priority` is deliberately left unregistered so the
 * spec can assert that an unregistered app-owned type still fails closed.
 */
if (parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)) {
  registerTaskEntityAclRequirements([
    { entityId: 'example:todo', view: ['example.todos.view'] },
    { entityId: 'example:example_item', view: ['example.todos.view'] },
  ])
  registerTaskEntityLinkBuilders([
    { entityId: 'example:todo', buildHref: (recordId) => `/backend/todos/${encodeURIComponent(recordId)}/edit` },
    { entityId: 'example:example_item', buildHref: (recordId) => `https://evil.example/items/${encodeURIComponent(recordId)}` },
  ])
}

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'example',
  workflows: [todoCreatedReference],
})

export default workflowsConfig

