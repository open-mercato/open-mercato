/**
 * @jest-environment node
 *
 * Versions of one workflow coexist as separate `workflow_definitions` rows, and
 * publishing copies the embedded triggers into the new row while the source row
 * stays enabled for the instances and pinned callers that still run it. The
 * trigger loader used to project every enabled row, so one event started one
 * instance per version, a trigger removed in the newest version kept firing
 * from the older rows, and a non-published row could auto-start.
 *
 * These tests lock the rule the versioning spec
 * (2026-06-26-subworkflow-explicit-ports-schema-builder) sets and that
 * `findWorkflowDefinition` already applies to unpinned starts: embedded
 * triggers come only from the highest enabled, published version of a workflow.
 */
jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn().mockResolvedValue(undefined),
  startWorkflow: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/core'
import {
  registerCodeWorkflowEntries,
  clearCodeWorkflowRegistry,
} from '@open-mercato/shared/modules/workflows/code-registry'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { WorkflowDefinition } from '../../data/entities'
import { startWorkflow } from '../workflow-executor'
import {
  invalidateTriggerCache,
  loadTriggersForTenant,
  processEventTriggers,
  resetTriggerDebounceState,
} from '../event-trigger-service'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const EVENT_NAME = 'sales.order.created'
const WORKFLOW_ID = 'order-follow-up'

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockStartWorkflow = startWorkflow as jest.MockedFunction<typeof startWorkflow>

type DefinitionRowOptions = {
  workflowId?: string
  enabled?: boolean
  lifecycle?: 'draft' | 'published' | 'archived'
  triggers?: Array<Record<string, unknown>>
}

function eventTrigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggerId: 'on-order-created',
    name: 'On order created',
    eventPattern: EVENT_NAME,
    enabled: true,
    priority: 0,
    config: null,
    ...overrides,
  }
}

function definitionRow(version: number, options: DefinitionRowOptions = {}) {
  const workflowId = options.workflowId ?? WORKFLOW_ID
  return {
    id: `${workflowId}-v${version}`,
    workflowId,
    version,
    enabled: options.enabled ?? true,
    lifecycle: options.lifecycle ?? 'published',
    definition: { steps: [], transitions: [], triggers: options.triggers ?? [eventTrigger()] },
  }
}

function fakeEntityManager(): EntityManager {
  const em = {
    count: jest.fn().mockResolvedValue(0),
    fork: jest.fn(() => em),
  }
  return em as unknown as EntityManager
}

function useDefinitionRows(rows: Array<ReturnType<typeof definitionRow>>): void {
  mockFindWithDecryption.mockImplementation((async (_em: unknown, entity: unknown) =>
    entity === WorkflowDefinition ? rows : []) as unknown as typeof findWithDecryption)
}

async function emitEvent(): Promise<Array<{ workflowId: string; version: number | undefined }>> {
  await processEventTriggers(fakeEntityManager(), { resolve: jest.fn() } as unknown as AwilixContainer, {
    eventName: EVENT_NAME,
    payload: { id: 'order-1' },
    tenantId: TENANT,
    organizationId: ORG,
  })
  return mockStartWorkflow.mock.calls.map(([, options]) => ({
    workflowId: options.workflowId,
    version: options.version,
  }))
}

describe('embedded triggers follow the latest published version', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCodeWorkflowRegistry()
    resetTriggerDebounceState()
    invalidateTriggerCache(TENANT)
    let started = 0
    mockStartWorkflow.mockImplementation((async () => ({ id: `instance-${++started}` })) as unknown as typeof startWorkflow)
  })

  afterAll(() => {
    clearCodeWorkflowRegistry()
    invalidateTriggerCache(TENANT)
  })

  it('starts one instance, at the newest version, when two published versions carry the trigger', async () => {
    useDefinitionRows([definitionRow(1), definitionRow(2)])

    expect(await emitEvent()).toEqual([{ workflowId: WORKFLOW_ID, version: 2 }])
  })

  it('picks the newest version whatever order the rows load in', async () => {
    useDefinitionRows([definitionRow(3), definitionRow(1), definitionRow(2)])

    expect(await emitEvent()).toEqual([{ workflowId: WORKFLOW_ID, version: 3 }])
  })

  it('binds the trigger to the newest version row, so its config and limits come from that version', async () => {
    useDefinitionRows([
      definitionRow(1, { triggers: [eventTrigger({ config: { maxConcurrentInstances: 1 } })] }),
      definitionRow(2, { triggers: [eventTrigger({ config: { maxConcurrentInstances: 5 } })] }),
    ])

    const triggers = await loadTriggersForTenant(fakeEntityManager(), TENANT, ORG)

    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({
      id: `${WORKFLOW_ID}-v2:on-order-created`,
      workflowDefinitionId: `${WORKFLOW_ID}-v2`,
      workflowVersion: 2,
      config: { maxConcurrentInstances: 5 },
      source: 'embedded',
    })
  })

  it('stops firing a trigger the newest version no longer declares', async () => {
    useDefinitionRows([definitionRow(1), definitionRow(2, { triggers: [] })])

    expect(await emitEvent()).toEqual([])
  })

  it('stops firing a trigger the newest version switched off', async () => {
    useDefinitionRows([definitionRow(1), definitionRow(2, { triggers: [eventTrigger({ enabled: false })] })])

    expect(await emitEvent()).toEqual([])
  })

  it('falls back to the highest enabled version when the newest one is disabled, like an unpinned start', async () => {
    useDefinitionRows([definitionRow(1), definitionRow(2), definitionRow(3, { enabled: false })])

    expect(await emitEvent()).toEqual([{ workflowId: WORKFLOW_ID, version: 2 }])
  })

  it.each(['draft', 'archived'] as const)('never auto-starts a %s version, even when it is the newest', async (lifecycle) => {
    useDefinitionRows([definitionRow(1), definitionRow(2, { lifecycle })])

    expect(await emitEvent()).toEqual([{ workflowId: WORKFLOW_ID, version: 1 }])
  })

  it.each(['draft', 'archived'] as const)('starts nothing for a workflow whose only version is %s', async (lifecycle) => {
    useDefinitionRows([definitionRow(1, { lifecycle })])

    expect(await emitEvent()).toEqual([])
  })

  it('resolves each workflow on its own', async () => {
    useDefinitionRows([
      definitionRow(1, { workflowId: 'first-workflow' }),
      definitionRow(2, { workflowId: 'first-workflow' }),
      definitionRow(4, { workflowId: 'second-workflow' }),
      definitionRow(5, { workflowId: 'second-workflow' }),
    ])

    const starts = await emitEvent()

    expect(starts).toHaveLength(2)
    expect(starts).toEqual(
      expect.arrayContaining([
        { workflowId: 'first-workflow', version: 2 },
        { workflowId: 'second-workflow', version: 5 },
      ]),
    )
  })

  it('keeps a database row shadowing the code-defined trigger when none of its versions resolve', async () => {
    const codeWorkflow: CodeWorkflowDefinition = {
      workflowId: WORKFLOW_ID,
      workflowName: 'Order follow-up',
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
        triggers: [eventTrigger()],
      } as CodeWorkflowDefinition['definition'],
    }
    registerCodeWorkflowEntries([{ moduleId: 'sales', workflows: [codeWorkflow] }])
    useDefinitionRows([definitionRow(1, { lifecycle: 'draft' }), definitionRow(2, { enabled: false })])

    expect(await emitEvent()).toEqual([])
  })
})
