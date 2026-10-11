/**
 * Correlation-key signal route (#7185).
 *
 * The fan-out used to answer with a bare success count, so a caller could not
 * tell which instances it failed to advance. The response now carries every
 * per-instance failure next to the count, and the count keeps its meaning.
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

jest.mock('../../lib/signal-handler', () => ({
  sendSignalByCorrelationKeyWithResults: jest.fn(),
}))

import { POST as sendByCorrelationKey } from '../signals/route'
import { sendSignalByCorrelationKeyWithResults } from '../../lib/signal-handler'
import { sendSignalByCorrelationResponseSchema } from '../openapi'

const mockSendWithResults = sendSignalByCorrelationKeyWithResults as jest.MockedFunction<
  typeof sendSignalByCorrelationKeyWithResults
>

const testTenantId = 'tenant-1'
const testOrgId = 'org-1'
const failedInstanceId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/workflows/signals', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/workflows/signals', () => {
  const mockEm = {}
  let mockRbac: { userHasAllFeatures: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? mockEm : name === 'rbacService' ? mockRbac : null),
    })

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: testTenantId, orgId: testOrgId })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
  })

  it('returns the per-instance failures next to the success count', async () => {
    mockSendWithResults.mockResolvedValueOnce({
      count: 2,
      failures: [{ instanceId: failedInstanceId, code: 'WORKFLOW_NOT_PAUSED', message: 'Workflow is not paused' }],
    })

    const response = await sendByCorrelationKey(
      makeRequest({ correlationKey: 'batch-1', signalName: 'approval_granted', payload: { approved: true } }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      message: 'Signal sent to 2 workflow(s)',
      count: 2,
      failures: [{ instanceId: failedInstanceId, code: 'WORKFLOW_NOT_PAUSED', message: 'Workflow is not paused' }],
    })
    expect(sendSignalByCorrelationResponseSchema.safeParse(body).success).toBe(true)
    expect(mockSendWithResults).toHaveBeenCalledWith(mockEm, expect.anything(), {
      correlationKey: 'batch-1',
      signalName: 'approval_granted',
      payload: { approved: true },
      userId: 'user-1',
      tenantId: testTenantId,
      organizationId: testOrgId,
    })
  })

  it('returns an empty failure list when every instance advanced', async () => {
    mockSendWithResults.mockResolvedValueOnce({ count: 1, failures: [] })

    const response = await sendByCorrelationKey(
      makeRequest({ correlationKey: 'batch-2', signalName: 'approval_granted' }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.failures).toEqual([])
  })

  it('refuses a caller without the signal feature before fanning out', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    const response = await sendByCorrelationKey(
      makeRequest({ correlationKey: 'batch-3', signalName: 'approval_granted' }),
    )

    expect(response.status).toBe(403)
    expect(mockSendWithResults).not.toHaveBeenCalled()
  })
})
