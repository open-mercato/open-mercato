/**
 * Advance refuses every ended run. A COMPENSATED run was rolled back on
 * purpose: parking it again would reopen it and compete for its business key.
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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('../../lib/workflow-executor', () => ({
  updateWorkflowContext: jest.fn(),
  executeWorkflow: jest.fn(),
  getWorkflowInstance: jest.fn(),
}))

jest.mock('../../lib/step-handler', () => ({}))

const executeTransition = jest.fn()
const findValidTransitions = jest.fn()
jest.mock('../../lib/transition-handler', () => ({
  executeTransition: (...args: unknown[]) => executeTransition(...args),
  findValidTransitions: (...args: unknown[]) => findValidTransitions(...args),
}))

import { POST as advance } from '../instances/[id]/advance/route'

const instanceId = '11111111-1111-4111-8111-111111111111'

test.each(['COMPLETED', 'CANCELLED', 'FAILED', 'COMPENSATED'])('refuses a %s run without touching it', async (status) => {
  const instance = { id: instanceId, status, tenantId: 'tenant-1', organizationId: 'org-1', currentStepId: 'review' }
  const em = { findOne: jest.fn().mockResolvedValue(instance), flush: jest.fn() }
  const rbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => (name === 'em' ? em : name === 'rbacService' ? rbac : null),
  })
  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
  const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'org-1' })

  const response = await advance(
    new NextRequest(`http://localhost/api/workflows/instances/${instanceId}/advance`, {
      method: 'POST',
      body: JSON.stringify({ contextUpdates: { reviewed: true } }),
    }),
    { params: Promise.resolve({ id: instanceId }) },
  )

  expect(response.status).toBe(400)
  expect(em.flush).not.toHaveBeenCalled()
  expect(findValidTransitions).not.toHaveBeenCalled()
  expect(executeTransition).not.toHaveBeenCalled()
})
