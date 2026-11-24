/**
 * Manual advance — a step that fails on entry answers in the reader's locale,
 * and a failure of the step the cursor already advanced into goes through the
 * engine's failure contract instead of stranding the run at a failed step.
 */

import { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: jest.fn(() => 'org-1'),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string, params: Record<string, string>) =>
      key === 'workflows.some.key' ? `po polsku: ${params.value}` : fallback,
  })),
}))

const executeTransition = jest.fn()
jest.mock('../../lib/transition-handler', () => ({
  findValidTransitions: jest.fn(async () => [
    { isValid: true, transition: { transitionId: 't1', fromStepId: 'start', toStepId: 'review' } },
  ]),
  executeTransition: (...args: unknown[]) => executeTransition(...(args as [])),
}))

const handleTransitionFailure = jest.fn()
const executeWorkflow = jest.fn()
jest.mock('../../lib/workflow-executor', () => ({
  handleTransitionFailure: (...args: unknown[]) => handleTransitionFailure(...(args as [])),
  executeWorkflow: (...args: unknown[]) => executeWorkflow(...(args as [])),
}))
jest.mock('../../lib/step-handler', () => ({}))

import { POST as advance } from '../instances/[id]/advance/route'

function request() {
  return new NextRequest('http://localhost/api/workflows/instances/instance-1/advance', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

let instance: Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  instance = { id: 'instance-1', status: 'RUNNING', currentStepId: 'start', context: {} }
  const em = { findOne: jest.fn().mockResolvedValue(instance), refresh: jest.fn() }
  const rbacService = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => (name === 'em' ? em : name === 'rbacService' ? rbacService : null),
  })
  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
})

test('localizes a keyed step failure and returns its details', async () => {
  const details = { i18n: { key: 'workflows.some.key', params: { value: 'x' } } }
  executeTransition.mockResolvedValue({ success: false, error: 'English', details })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })
  const body = await response.json()

  expect(response.status).toBe(400)
  expect(body).toEqual({ error: 'Transition failed', reason: 'po polsku: x', details })
})

test('an unkeyed failure keeps its reason and adds no details', async () => {
  executeTransition.mockResolvedValue({ success: false, error: 'Gateway timeout' })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })

  expect(await response.json()).toEqual({ error: 'Transition failed', reason: 'Gateway timeout' })
})

test('a pre-step refusal leaves the run where it was and never applies the failure contract', async () => {
  executeTransition.mockResolvedValue({ success: false, error: 'Pre-conditions failed: r1' })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })

  expect(response.status).toBe(400)
  expect(handleTransitionFailure).not.toHaveBeenCalled()
})

test('an executed step failure goes through the failure contract and keeps the 400 contract when terminal', async () => {
  const details = { i18n: { key: 'workflows.some.key', params: { value: 'x' } } }
  const transitionResult = { success: false, error: 'English', details, stepExecutionFailed: true }
  executeTransition.mockResolvedValue(transitionResult)
  handleTransitionFailure.mockResolvedValue({ kind: 'failed', error: 'English', notes: [] })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })

  expect(handleTransitionFailure).toHaveBeenCalledTimes(1)
  const [, , failedInstance, passedResult, options] = handleTransitionFailure.mock.calls[0]
  expect(failedInstance).toBe(instance)
  expect(passedResult).toBe(transitionResult)
  expect(options).toMatchObject({ fromStepId: 'start', toStepId: 'review', source: 'manual-advance' })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Transition failed', reason: 'po polsku: x', details })
  expect(executeWorkflow).not.toHaveBeenCalled()
})

test('a parked step failure keeps the 400 contract', async () => {
  executeTransition.mockResolvedValue({ success: false, error: 'Boom', stepExecutionFailed: true, failedStepId: 'review', parkForAttention: true })
  handleTransitionFailure.mockResolvedValue({ kind: 'parked', failedStepId: 'review', notes: [] })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })

  expect(response.status).toBe(400)
  expect(executeWorkflow).not.toHaveBeenCalled()
})

test.each([
  ['errorRouted', { kind: 'errorRouted', failedStepId: 'review', toStepId: 'recover', notes: [] }],
  ['errorHandlerStarted', { kind: 'errorHandlerStarted', failedStepId: 'review', handlerStepId: 'handler', notes: [] }],
])('an authored recovery (%s) continues the run like a successful advance', async (_kind, outcome) => {
  executeTransition.mockResolvedValue({
    success: false,
    error: 'Boom',
    stepExecutionFailed: true,
    failedStepId: 'review',
    errorRoute: { toStepId: 'recover' },
  })
  handleTransitionFailure.mockResolvedValue(outcome)
  executeWorkflow.mockResolvedValue({ status: 'RUNNING', events: [], executionTime: 1 })

  const response = await advance(request(), { params: Promise.resolve({ id: 'instance-1' }) })

  expect(response.status).toBe(200)
  expect(executeWorkflow).toHaveBeenCalledTimes(1)
  expect((await response.json()).message).toBe('Workflow advanced successfully')
})
