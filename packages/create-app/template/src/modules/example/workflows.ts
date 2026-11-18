import {
  createWorkflowsModuleConfig,
  defineWorkflow,
} from '@open-mercato/shared/modules/workflows'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

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

const VERSION_PINNING_FIXTURE_WORKFLOW_ID = 'example.version-pinning-fixture'
const VERSION_PINNING_FIXTURE_SIGNAL = 'example_version_pinning_approve'

function versionPinningFixture(version: 1 | 2) {
  const waitStepId = `wait_v${version}`
  const approvedStepId = `approved_v${version}`
  return defineWorkflow({
    workflowId: VERSION_PINNING_FIXTURE_WORKFLOW_ID,
    workflowName: `Example Version Pinning Fixture v${version}`,
    description: 'Integration-test fixture: two retained versions that park on a signal and take different paths.',
    version,
    metadata: {
      category: 'Example',
      tags: ['example', 'integration-test'],
    },
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: waitStepId,
        stepName: `Wait v${version}`,
        stepType: 'WAIT_FOR_SIGNAL',
        signalConfig: { signalName: VERSION_PINNING_FIXTURE_SIGNAL },
      },
      { stepId: approvedStepId, stepName: `Approved v${version}`, stepType: 'AUTOMATED' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: `start_to_${waitStepId}`, fromStepId: 'start', toStepId: waitStepId, trigger: 'auto', priority: 0 },
      { transitionId: `${waitStepId}_to_${approvedStepId}`, fromStepId: waitStepId, toStepId: approvedStepId, trigger: 'auto', priority: 0 },
      { transitionId: `${approvedStepId}_to_end`, fromStepId: approvedStepId, toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  })
}

const integrationTestWorkflows = parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)
  ? [versionPinningFixture(1), versionPinningFixture(2)]
  : []

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'example',
  workflows: [todoCreatedReference, ...integrationTestWorkflows],
})

export default workflowsConfig

