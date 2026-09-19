/**
 * Per-definition KPI read route + rollup worker wiring (spec §8.5).
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

const computeDefinitionMetrics = jest.fn()
jest.mock('../../lib/metrics/rollup-service', () => ({
  computeDefinitionMetrics: (...args: unknown[]) => computeDefinitionMetrics(...args),
}))

import {
  GET as readDefinitionMetrics,
  ROLLUP_FRESHNESS_MS,
  WORKFLOW_METRICS_MAX_IDS,
} from '../metrics/definitions/route'
import { EMPTY_DEFINITION_METRICS } from '../../lib/metrics/definition-metrics'

const tenantId = 'tenant-1'
const orgId = 'org-1'

const liveMetrics = { ...EMPTY_DEFINITION_METRICS, runsStarted: 7 }
const storedMetrics = { ...EMPTY_DEFINITION_METRICS, runsStarted: 3 }

let mockEm: { find: jest.Mock }

function request(query: string) {
  return new NextRequest(`http://localhost/api/workflows/metrics/definitions${query}`)
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'checkout',
    windowKey: '7d',
    windowStart: new Date('2026-07-13T00:00:00.000Z'),
    windowEnd: new Date('2026-07-20T00:00:00.000Z'),
    computedAt: new Date(),
    metrics: storedMetrics,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockEm = { find: jest.fn().mockResolvedValue([]) }
  computeDefinitionMetrics.mockResolvedValue(liveMetrics)

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => (name === 'em' ? mockEm : null),
  })

  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId, orgId })

  const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: orgId })
})

describe('GET /api/workflows/metrics/definitions', () => {
  test('is gated on its own metrics feature, not on plain definition view', () => {
    const { metadata } = require('../metrics/definitions/route')
    expect(metadata.requireFeatures).toEqual(['workflows.metrics.view'])
    expect(metadata.requireAuth).toBe(true)
  })

  test('401s an unauthenticated caller before reading anything', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))

    expect(response.status).toBe(401)
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('400s a caller with no tenant context rather than reading across tenants', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId })

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))

    expect(response.status).toBe(400)
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('scopes the rollup lookup by tenant AND organization', async () => {
    await readDefinitionMetrics(request('?workflowIds=checkout,refund'))

    const where = mockEm.find.mock.calls[0][1]
    expect(where.tenantId).toBe(tenantId)
    expect(where.organizationId).toBe(orgId)
    expect(where.workflowId).toEqual({ $in: ['checkout', 'refund'] })
    expect(where.windowKey).toBe('7d')
  })

  test('serves a fresh stored rollup and says so', async () => {
    mockEm.find.mockResolvedValue([storedRow()])

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))
    const body = await response.json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].source).toBe('rollup')
    expect(body.data[0].metrics.runsStarted).toBe(3)
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('recomputes live when the stored rollup is stale', async () => {
    mockEm.find.mockResolvedValue([
      storedRow({ computedAt: new Date(Date.now() - ROLLUP_FRESHNESS_MS - 1000) }),
    ])

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))
    const body = await response.json()

    expect(body.data[0].source).toBe('live')
    expect(body.data[0].metrics.runsStarted).toBe(7)
  })

  test('recomputes live when a stored row no longer matches the metrics contract', async () => {
    // A row written by an older build must be refused rather than trusted.
    mockEm.find.mockResolvedValue([storedRow({ metrics: { runsStarted: 'lots' } })])

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))
    const body = await response.json()

    expect(body.data[0].source).toBe('live')
  })

  test('recomputes live and skips the rollup table when the scope spans several organizations', async () => {
    // Counts would sum across organizations but a percentile would not, so a
    // multi-org read must not be served from per-org rows.
    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: [orgId, 'org-2'] })

    const response = await readDefinitionMetrics(request('?workflowIds=checkout'))
    const body = await response.json()

    expect(mockEm.find).not.toHaveBeenCalled()
    expect(body.data[0].source).toBe('live')
    expect(computeDefinitionMetrics).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId, organizationIds: [orgId, 'org-2'] },
      expect.objectContaining({ workflowId: 'checkout' }),
    )
  })

  test('a tenant-wide scope still carries the tenant into the live compute', async () => {
    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })

    await readDefinitionMetrics(request('?workflowIds=checkout'))

    expect(computeDefinitionMetrics).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId, organizationIds: undefined },
      expect.anything(),
    )
  })

  test('deduplicates ids so one row is not asked about twice', async () => {
    await readDefinitionMetrics(request('?workflowIds=checkout,checkout,refund'))

    expect(mockEm.find.mock.calls[0][1].workflowId).toEqual({ $in: ['checkout', 'refund'] })
    expect(computeDefinitionMetrics).toHaveBeenCalledTimes(2)
  })

  test('400s an unknown window rather than silently defaulting', async () => {
    const response = await readDefinitionMetrics(request('?workflowIds=checkout&window=90d'))
    expect(response.status).toBe(400)
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('400s a missing or empty id list', async () => {
    expect((await readDefinitionMetrics(request(''))).status).toBe(400)
    expect((await readDefinitionMetrics(request('?workflowIds=' + encodeURIComponent(' , ')))).status).toBe(400)
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('refuses a batch larger than the cap instead of scanning it', async () => {
    const ids = Array.from({ length: WORKFLOW_METRICS_MAX_IDS + 1 }, (_unused, index) => `wf-${index}`)

    const response = await readDefinitionMetrics(request(`?workflowIds=${ids.join(',')}`))

    expect(response.status).toBe(400)
    expect(WORKFLOW_METRICS_MAX_IDS).toBeLessThanOrEqual(100)
    expect(computeDefinitionMetrics).not.toHaveBeenCalled()
  })

  test('exports an openApi contract naming the query and the 200 shape', () => {
    const { openApi } = require('../metrics/definitions/route')
    expect(openApi.methods.GET.query).toBeDefined()
    expect(openApi.methods.GET.responses.map((entry: { status: number }) => entry.status)).toContain(200)
  })
})

describe('workflows.metrics.view ACL', () => {
  test('is declared and depends on definition view', () => {
    const { features } = require('../../acl')
    const feature = features.find((entry: { id: string }) => entry.id === 'workflows.metrics.view')
    expect(feature).toBeDefined()
    expect(feature.dependsOn).toEqual(['workflows.definitions.view'])
  })
})
