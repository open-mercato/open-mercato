/** @jest-environment node */

import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { GET, openApi } from '../[id]/route'
import { integrationDetailResponseSchema } from '../openapi'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'),
  getIntegration: jest.fn(),
}))

jest.mock('../umes-read', () => ({
  integrationApiRoutePaths: { list: 'integrations', detail: 'integrations/detail', logs: 'integrations/logs' },
  runIntegrationsReadBeforeInterceptors: jest.fn(async () => ({ ok: true, request: {}, metadataByInterceptor: {} })),
  finalizeIntegrationsReadResponse: jest.fn(async ({ body }: { body: Record<string, unknown> }) => NextResponse.json(body)),
}))

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }
const INTEGRATION = {
  id: 'test_oauth_grant',
  title: 'Zz Test OAuth Grant',
  credentials: { fields: [] },
  detailPage: { connectTabId: 'health' },
}

function buildRequest(): Request {
  return new Request('http://localhost/api/integrations/test_oauth_grant', { method: 'GET' })
}

describe('GET /api/integrations/:id — oauthGrant', () => {
  const readGrantStatus = jest.fn()
  const reportError = jest.fn()
  let resolveGrantService: () => unknown

  beforeEach(() => {
    jest.clearAllMocks()
    resolveGrantService = () => ({ readGrantStatus })
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: SCOPE.tenantId, orgId: SCOPE.organizationId })
    ;(getIntegration as jest.Mock).mockReturnValue(INTEGRATION)
    ;(getTelemetryRuntime as jest.Mock).mockReturnValue({ reportError })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'integrationCredentialsService') {
          return { resolve: async () => null, resolveUpdatedAt: async () => null }
        }
        if (key === 'integrationStateService') {
          return {
            resolveState: async () => ({
              isEnabled: false,
              apiVersion: null,
              reauthRequired: false,
              lastHealthStatus: null,
              lastHealthCheckedAt: null,
              lastHealthLatencyMs: null,
              enabledAt: null,
              updatedAt: null,
            }),
          }
        }
        if (key === 'integrationLogService') return { aggregateAnalytics: async () => new Map() }
        if (key === 'integrationOAuthGrantService') return resolveGrantService()
        throw new Error(`unexpected resolve(${key})`)
      },
    })
  })

  async function readDetail(): Promise<Record<string, unknown>> {
    const response = await GET(buildRequest(), { params: { id: INTEGRATION.id } })
    expect(response.status).toBe(200)
    return (await response.json()) as Record<string, unknown>
  }

  it('returns null without a live grant', async () => {
    readGrantStatus.mockResolvedValue(null)

    const body = await readDetail()

    expect(body.oauthGrant).toBeNull()
    expect(readGrantStatus).toHaveBeenCalledWith(INTEGRATION.id, SCOPE)
  })

  it.each(['active', 'invalidated', 'unavailable'] as const)('returns only { status } for a %s grant', async (status) => {
    readGrantStatus.mockResolvedValue(status)

    const body = await readDetail()

    expect(body.oauthGrant).toEqual({ status })
    expect(Object.keys(body.oauthGrant as Record<string, unknown>)).toEqual(['status'])
    expect(integrationDetailResponseSchema.safeParse(body).success).toBe(true)
  })

  it('returns connectTabId inside integration.detailPage', async () => {
    readGrantStatus.mockResolvedValue(null)

    const body = await readDetail()

    expect((body.integration as { detailPage?: { connectTabId?: string } }).detailPage?.connectTabId).toBe('health')
  })

  it('maps an unexpected grant read failure to unavailable and reports it instead of answering 500', async () => {
    const failure = new Error('boom')
    readGrantStatus.mockRejectedValue(failure)

    const body = await readDetail()

    expect(body.oauthGrant).toEqual({ status: 'unavailable' })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'integrations',
      code: 'integrations.oauth_inspect_failed',
    }))
  })

  it('maps a missing grant service to unavailable', async () => {
    resolveGrantService = () => {
      throw new Error('not registered')
    }

    const body = await readDetail()

    expect(body.oauthGrant).toEqual({ status: 'unavailable' })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('documents the oauthGrant field in the GET response schema', () => {
    const responses = openApi.methods.GET?.responses ?? []
    expect(responses.find((entry) => entry.status === 200)?.schema).toBe(integrationDetailResponseSchema)
    expect(integrationDetailResponseSchema.shape.oauthGrant.safeParse(null).success).toBe(true)
    expect(integrationDetailResponseSchema.shape.oauthGrant.safeParse({ status: 'revoked' }).success).toBe(false)
  })
})
