/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../guards'
import { POST } from '../[id]/health/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'),
  getIntegration: jest.fn(),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runIntegrationMutationGuards: jest.fn(),
  runIntegrationMutationGuardAfterSuccess: jest.fn(),
}))

function buildRequest(): Request {
  return new Request('http://localhost/api/integrations/sync_akeneo/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

describe('integrations health POST route — mutation guard contract', () => {
  const runHealthCheckMock = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    runHealthCheckMock.mockReset()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(getIntegration as jest.Mock).mockReturnValue({ id: 'sync_akeneo', title: 'Akeneo PIM' })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'integrationHealthService') {
          return { runHealthCheck: runHealthCheckMock }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    })
  })

  it('blocks the health probe and after-success callbacks when a guard denies the mutation', async () => {
    ;(runIntegrationMutationGuards as jest.Mock).mockResolvedValue({
      ok: false,
      errorStatus: 403,
      errorBody: { error: 'Blocked by guard' },
      afterSuccessCallbacks: [],
    })

    const response = await POST(buildRequest(), { params: { id: 'sync_akeneo' } })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({ error: 'Blocked by guard' })
    expect(runHealthCheckMock).not.toHaveBeenCalled()
    expect(runIntegrationMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })

  it('runs the probe and after-success callbacks when guards pass', async () => {
    const checkedAt = new Date('2026-06-19T00:00:00.000Z').toISOString()
    ;(runIntegrationMutationGuards as jest.Mock).mockResolvedValue({
      ok: true,
      afterSuccessCallbacks: [{ guard: {}, metadata: null }],
    })
    runHealthCheckMock.mockResolvedValue({
      status: 'healthy',
      message: 'ok',
      details: { foo: 'bar' },
      latencyMs: 12,
      checkedAt,
    })

    const response = await POST(buildRequest(), { params: { id: 'sync_akeneo' } })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      status: 'healthy',
      message: 'ok',
      details: { foo: 'bar' },
      latencyMs: 12,
      checkedAt,
    })
    expect(runHealthCheckMock).toHaveBeenCalledWith('sync_akeneo', { organizationId: 'o1', tenantId: 't1' })

    const guardCallOrder = (runIntegrationMutationGuards as jest.Mock).mock.invocationCallOrder[0]
    const probeCallOrder = runHealthCheckMock.mock.invocationCallOrder[0]
    const afterSuccessCallOrder = (runIntegrationMutationGuardAfterSuccess as jest.Mock).mock.invocationCallOrder[0]
    expect(guardCallOrder).toBeLessThan(probeCallOrder)
    expect(probeCallOrder).toBeLessThan(afterSuccessCallOrder)
    expect(runIntegrationMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
  })
})
