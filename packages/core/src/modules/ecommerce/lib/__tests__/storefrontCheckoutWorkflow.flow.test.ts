import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { EcommerceCheckoutSession } from '../../data/entities'
import type { WorkflowInstance } from '../../../workflows/data/entities'
import {
  applyCheckoutWorkflowAction,
  setCheckoutWorkflowTerminalState,
} from '../storefrontCheckoutWorkflow'

jest.mock('../../../workflows/lib/workflow-executor', () => ({
  startWorkflow: jest.fn(),
}))

jest.mock('../../../workflows/lib/transition-handler', () => ({
  executeTransition: jest.fn(),
}))

const { startWorkflow } = jest.requireMock('../../../workflows/lib/workflow-executor') as {
  startWorkflow: jest.Mock
}
const { executeTransition } = jest.requireMock('../../../workflows/lib/transition-handler') as {
  executeTransition: jest.Mock
}

function createSession(overrides: Partial<EcommerceCheckoutSession> = {}): EcommerceCheckoutSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
    storeId: '44444444-4444-4444-8444-444444444444',
    cartId: '55555555-5555-4555-8555-555555555555',
    cartToken: '66666666-6666-4666-8666-666666666666',
    workflowName: 'ecommerce.checkout.v1',
    workflowState: 'cart',
    status: 'active',
    version: 1,
    metadata: null,
    expiresAt: new Date('2026-02-21T12:00:00.000Z'),
    createdAt: new Date('2026-02-21T10:00:00.000Z'),
    updatedAt: new Date('2026-02-21T10:00:00.000Z'),
    ...overrides,
  } as EcommerceCheckoutSession
}

function createWorkflowInstance(stepId: string): WorkflowInstance {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    definitionId: '88888888-8888-4888-8888-888888888888',
    workflowId: 'ecommerce_checkout_v1',
    version: 1,
    status: 'RUNNING',
    currentStepId: stepId,
    context: {},
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
  } as WorkflowInstance
}

describe('storefrontCheckoutWorkflow flow', () => {
  let em: jest.Mocked<EntityManager>
  let container: jest.Mocked<AwilixContainer>
  let workflowInstance: WorkflowInstance

  beforeEach(() => {
    workflowInstance = createWorkflowInstance('cart')

    em = {
      findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
        if (where.workflowId === 'ecommerce_checkout_v1') {
          return null
        }
        if (where.id === workflowInstance.id) {
          return workflowInstance
        }
        return null
      }),
      create: jest.fn((_, data) => data),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn(async (instance: WorkflowInstance) => instance),
    } as unknown as jest.Mocked<EntityManager>

    container = {} as jest.Mocked<AwilixContainer>

    startWorkflow.mockReset()
    executeTransition.mockReset()

    startWorkflow.mockImplementation(async () => workflowInstance)
    executeTransition.mockImplementation(
      async (
        _em: EntityManager,
        _container: AwilixContainer,
        instance: WorkflowInstance,
        _fromStep: string,
        toStep: string,
      ) => {
        instance.currentStepId = toStep
        return { success: true, nextStepId: toStep }
      },
    )
  })

  it('executes checkout sequence through workflow runtime', async () => {
    const session = createSession()

    const setCustomer = await applyCheckoutWorkflowAction(em, container, session, 'set_customer')
    expect(setCustomer.ok).toBe(true)
    expect(session.workflowState).toBe('customer')

    const review = await applyCheckoutWorkflowAction(em, container, session, 'review')
    expect(review.ok).toBe(true)
    expect(session.workflowState).toBe('review')

    const placeOrder = await applyCheckoutWorkflowAction(em, container, session, 'place_order')
    expect(placeOrder.ok).toBe(true)
    expect(session.workflowState).toBe('placing_order')

    const completed = await setCheckoutWorkflowTerminalState(em, container, session, 'completed')
    expect(completed.ok).toBe(true)
    expect(session.workflowState).toBe('completed')
  })

  it('rejects disallowed transition from current workflow step', async () => {
    const session = createSession()
    const result = await applyCheckoutWorkflowAction(em, container, session, 'place_order')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('not allowed')
    }
    expect(executeTransition).not.toHaveBeenCalled()
  })

  it('moves to failed terminal state when placing order fails', async () => {
    const session = createSession({ workflowState: 'placing_order' })
    workflowInstance.currentStepId = 'placing_order'
    session.metadata = {
      workflowInstanceId: workflowInstance.id,
    }

    const failed = await setCheckoutWorkflowTerminalState(em, container, session, 'failed')
    expect(failed.ok).toBe(true)
    expect(session.workflowState).toBe('failed')
  })
})
