/**
 * Manual advance — a step that fails on entry answers in the reader's locale.
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

jest.mock('../../lib/workflow-executor', () => ({}))
jest.mock('../../lib/step-handler', () => ({}))

import { POST as advance } from '../instances/[id]/advance/route'

function request() {
  return new NextRequest('http://localhost/api/workflows/instances/instance-1/advance', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const instance = { id: 'instance-1', status: 'RUNNING', currentStepId: 'start', context: {} }
  const em = { findOne: jest.fn().mockResolvedValue(instance) }
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
