/** @jest-environment node */
import { NextRequest } from 'next/server'
import { LockMode } from '@mikro-orm/postgresql'
import { WorkflowInstance } from '../../data/entities'
import { findReservedContextKeys } from '../../lib/workflow-executor'
import { POST } from '../instances/[id]/advance/route'

const tenantId = 'tenant'
const organizationId = 'organization'
const instanceId = 'instance'
const transaction = { refresh: jest.fn(async () => undefined) }
const transactional = jest.fn(async (work: (em: typeof transaction) => Promise<unknown>) => work(transaction))
const manager = { transactional }
const findOneWithDecryption = jest.fn()
const findValidTransitions = jest.fn()
const executeTransition = jest.fn()
const executeWorkflow = jest.fn()
const instance = {
  id: instanceId,
  status: 'RUNNING',
  currentStepId: 'start',
  context: { previousValue: true },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve(key: string) {
      if (key === 'em') return manager
      if (key === 'rbacService') return { userHasAllFeatures: async () => true }
      if (key === 'workflowExecutor') return { findReservedContextKeys, executeWorkflow }
      if (key === 'transitionHandler') return { findValidTransitions, executeTransition }
      throw new Error(`[internal] Missing registration ${key}`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user', tenantId, orgId: organizationId }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => null,
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: () => organizationId,
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

function advance(contextUpdates: Record<string, unknown>) {
  const request = new NextRequest('https://app.example/api/workflows/instances/instance/advance', {
    method: 'POST',
    body: JSON.stringify({ contextUpdates }),
  })
  return POST(request, { params: Promise.resolve({ id: instanceId }) })
}

beforeEach(() => {
  jest.clearAllMocks()
  findOneWithDecryption.mockResolvedValue(instance)
})

it('rejects engine-owned context without acquiring the instance write lock', async () => {
  const response = await advance({ __result: 'invalid' })

  expect(response.status).toBe(400)
  expect(transactional).not.toHaveBeenCalled()
  expect(executeTransition).not.toHaveBeenCalled()
})

it('evaluates caller context without modifying the stored context on an unavailable transition', async () => {
  findValidTransitions.mockResolvedValue([])

  const response = await advance({ proposed: true })

  expect(response.status).toBe(400)
  expect(findOneWithDecryption).toHaveBeenCalledWith(transaction, WorkflowInstance, {
    id: instanceId,
    tenantId,
    organizationId,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId, organizationId })
  expect(findValidTransitions).toHaveBeenCalledWith(transaction, instance, 'start', expect.objectContaining({
    workflowContext: { previousValue: true, proposed: true },
  }))
  expect(instance.context).toEqual({ previousValue: true })
  expect(executeTransition).not.toHaveBeenCalled()
})

it('passes caller context into the locked transition and advances after the transaction finishes', async () => {
  findValidTransitions.mockResolvedValue([{ isValid: true, transition: { fromStepId: 'start', toStepId: 'end' } }])
  executeTransition.mockResolvedValue({ success: true })
  executeWorkflow.mockResolvedValue({ status: 'COMPLETED' })

  const response = await advance({ approved: true })

  expect(response.status).toBe(200)
  expect(executeTransition).toHaveBeenCalledWith(transaction, expect.anything(), instance, 'start', 'end', expect.objectContaining({
    workflowContext: { previousValue: true, approved: true },
  }))
  expect(executeWorkflow).toHaveBeenCalledWith(manager, expect.anything(), instanceId, { userId: 'user' })
})
