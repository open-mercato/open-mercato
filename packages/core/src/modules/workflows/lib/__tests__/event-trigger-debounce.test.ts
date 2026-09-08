/**
 * @jest-environment node
 *
 * Guards #5922: a trigger's `debounceMs` was declared on the type
 * (`packages/shared/src/modules/workflows/types.ts`), stored on the entity,
 * validated by the definitions API and offered as a field in the visual editor
 * — but `processEventTriggers` never read it, so the documented trigger-storm
 * protection was a silent no-op. Its sibling guard `maxConcurrentInstances` was
 * consumed in the same loop, which is what made the omission easy to miss.
 *
 * These tests lock the leading-edge semantics: the first event starts the
 * workflow and opens the window, repeats inside it are counted as `skipped`,
 * and the window is scoped per trigger, per entity and per tenant so unrelated
 * events never suppress each other.
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
import { startWorkflow } from '../workflow-executor'
import {
  invalidateTriggerCache,
  processEventTriggers,
  resetTriggerDebounceState,
} from '../event-trigger-service'

const TENANT = 'tenant-1'
const OTHER_TENANT = 'tenant-2'
const ORG = 'org-1'
const EVENT_NAME = 'sales.order.updated'
const DEBOUNCE_MS = 5000

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockStartWorkflow = startWorkflow as jest.MockedFunction<typeof startWorkflow>

function codeWorkflow(
  workflowId: string,
  triggerConfig: Record<string, unknown> | null,
): CodeWorkflowDefinition {
  return {
    workflowId,
    workflowName: 'Order Follow-up',
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
          triggerId: 'on-order-updated',
          name: 'On order updated',
          eventPattern: EVENT_NAME,
          enabled: true,
          priority: 10,
          config: triggerConfig,
        },
      ],
    } as CodeWorkflowDefinition['definition'],
  }
}

function fakeEntityManager(): EntityManager {
  const em = {
    count: jest.fn().mockResolvedValue(0),
    fork: jest.fn(() => em),
  }
  return em as unknown as EntityManager
}

function fakeContainer(): AwilixContainer {
  return { resolve: jest.fn() } as unknown as AwilixContainer
}

async function emitEvent(
  payload: Record<string, unknown>,
  tenantId: string = TENANT,
): Promise<{ triggered: number; skipped: number }> {
  const result = await processEventTriggers(fakeEntityManager(), fakeContainer(), {
    eventName: EVENT_NAME,
    payload,
    tenantId,
    organizationId: ORG,
  })
  return { triggered: result.triggered, skipped: result.skipped }
}

describe('processEventTriggers — trigger debounceMs (#5922)', () => {
  let nowSpy: jest.SpyInstance<number, []>
  let currentTime: number

  beforeEach(() => {
    currentTime = 1_700_000_000_000
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime)
    // Both DB-backed trigger loaders return nothing; the code registry is the
    // only source, which keeps the test free of ORM fixtures.
    mockFindWithDecryption.mockResolvedValue([] as never)
    mockStartWorkflow.mockImplementation(async () => ({ id: `instance-${currentTime}` }) as never)
  })

  afterEach(() => {
    nowSpy.mockRestore()
    clearCodeWorkflowRegistry()
    invalidateTriggerCache(TENANT, ORG)
    invalidateTriggerCache(OTHER_TENANT, ORG)
    resetTriggerDebounceState()
    mockFindWithDecryption.mockReset()
    mockStartWorkflow.mockReset()
  })

  it('drops a repeat event that arrives inside the debounce window', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    const first = await emitEvent({ id: 'order-1' })
    currentTime += DEBOUNCE_MS - 1
    const second = await emitEvent({ id: 'order-1' })

    expect(first).toEqual({ triggered: 1, skipped: 0 })
    expect(second).toEqual({ triggered: 0, skipped: 1 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1)
  })

  it('starts the workflow again once the debounce window has elapsed', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    await emitEvent({ id: 'order-1' })
    currentTime += DEBOUNCE_MS
    const afterWindow = await emitEvent({ id: 'order-1' })

    expect(afterWindow).toEqual({ triggered: 1, skipped: 0 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(2)
  })

  it('does not debounce when debounceMs is absent or zero', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', null)])

    await emitEvent({ id: 'order-1' })
    const immediateRepeat = await emitEvent({ id: 'order-1' })

    expect(immediateRepeat).toEqual({ triggered: 1, skipped: 0 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(2)

    clearCodeWorkflowRegistry()
    invalidateTriggerCache(TENANT, ORG)
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: 0 })])

    await emitEvent({ id: 'order-2' })
    const zeroWindowRepeat = await emitEvent({ id: 'order-2' })

    expect(zeroWindowRepeat).toEqual({ triggered: 1, skipped: 0 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(4)
  })

  it('keeps the debounce window per entity so a different record still triggers', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    await emitEvent({ id: 'order-1' })
    const otherEntity = await emitEvent({ id: 'order-2' })

    expect(otherEntity).toEqual({ triggered: 1, skipped: 0 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(2)
  })

  it('keeps the debounce window per tenant so one tenant cannot suppress another', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    await emitEvent({ id: 'order-1' }, TENANT)
    const otherTenant = await emitEvent({ id: 'order-1' }, OTHER_TENANT)

    expect(otherTenant).toEqual({ triggered: 1, skipped: 0 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(2)
  })

  it('keeps the window per entity when the payload id is numeric', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    await emitEvent({ id: 1 })
    const otherNumericEntity = await emitEvent({ id: 2 })
    const sameNumericEntity = await emitEvent({ id: 1 })

    expect(otherNumericEntity).toEqual({ triggered: 1, skipped: 0 })
    expect(sameNumericEntity).toEqual({ triggered: 0, skipped: 1 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(2)
  })

  it('debounces per trigger when the event payload carries no entity id', async () => {
    registerCodeWorkflowEntries([codeWorkflow('sales.order-followup', { debounceMs: DEBOUNCE_MS })])

    const first = await emitEvent({})
    const second = await emitEvent({})

    expect(first).toEqual({ triggered: 1, skipped: 0 })
    expect(second).toEqual({ triggered: 0, skipped: 1 })
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1)
  })
})
