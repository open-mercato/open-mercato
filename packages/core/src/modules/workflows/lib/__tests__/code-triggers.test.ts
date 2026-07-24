/**
 * @jest-environment node
 *
 * Guards #4425: triggers declared on a code-defined workflow never reached the
 * trigger engine, because `loadTriggersForTenant` merged only the two DB-backed
 * sources. `loadCodeTriggers` projects the in-memory registry's triggers into
 * UnifiedTriggers so a code-declared trigger auto-starts its workflow without an
 * operator first customizing the definition into a DB row.
 */
jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))

import {
  registerCodeWorkflowEntries,
  clearCodeWorkflowRegistry,
} from '@open-mercato/shared/modules/workflows/code-registry'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { loadCodeTriggers } from '../event-trigger-service'
import { codeWorkflowUuid } from '../find-definition'

const TENANT = 'tenant-1'
const ORG = 'org-1'

function codeWorkflow(overrides: Partial<CodeWorkflowDefinition> = {}): CodeWorkflowDefinition {
  return {
    workflowId: 'sales.order-approval',
    workflowName: 'Order Approval',
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'sales',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      triggers: [
        {
          triggerId: 'on-order-created',
          name: 'On order created',
          eventPattern: 'sales.order.created',
          enabled: true,
          priority: 10,
          config: null,
        },
      ],
    } as CodeWorkflowDefinition['definition'],
    ...overrides,
  }
}

describe('loadCodeTriggers (#4425)', () => {
  afterEach(() => clearCodeWorkflowRegistry())

  it('projects a code workflow trigger into a UnifiedTrigger', () => {
    registerCodeWorkflowEntries([codeWorkflow()])

    const triggers = loadCodeTriggers(TENANT, ORG, new Set())

    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({
      triggerId: 'on-order-created',
      eventPattern: 'sales.order.created',
      workflowId: 'sales.order-approval',
      workflowVersion: 1,
      source: 'code',
      tenantId: TENANT,
      organizationId: ORG,
    })
    // definitionId must match what startWorkflow persists, so the concurrency
    // limit counts the right instances.
    expect(triggers[0].workflowDefinitionId).toBe(codeWorkflowUuid('sales.order-approval'))
    expect(triggers[0].id).toBe('code:sales.order-approval:on-order-created')
  })

  it('is suppressed when a DB-backed definition exists for the same workflowId (customize wins)', () => {
    registerCodeWorkflowEntries([codeWorkflow()])

    const triggers = loadCodeTriggers(TENANT, ORG, new Set(['sales.order-approval']))

    expect(triggers).toHaveLength(0)
  })

  it('skips disabled code workflows and disabled triggers', () => {
    registerCodeWorkflowEntries([
      codeWorkflow({ workflowId: 'wf.disabled-workflow', enabled: false }),
      codeWorkflow({
        workflowId: 'wf.disabled-trigger',
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
          triggers: [
            {
              triggerId: 'off',
              name: 'Disabled trigger',
              eventPattern: 'x.y.z',
              enabled: false,
              priority: 0,
              config: null,
            },
          ],
        } as CodeWorkflowDefinition['definition'],
      }),
    ])

    expect(loadCodeTriggers(TENANT, ORG, new Set())).toHaveLength(0)
  })

  it('ignores code workflows that declare no triggers', () => {
    registerCodeWorkflowEntries([
      codeWorkflow({
        workflowId: 'wf.no-triggers',
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
        } as CodeWorkflowDefinition['definition'],
      }),
    ])

    expect(loadCodeTriggers(TENANT, ORG, new Set())).toHaveLength(0)
  })
})
