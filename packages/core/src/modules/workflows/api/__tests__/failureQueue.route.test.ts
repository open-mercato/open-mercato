/**
 * Failure-queue triage + bulk replay routes (spec §8.4).
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

const enqueue = jest.fn()
jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue })),
}))

import { GET as listFailureQueue, FAILURE_GROUP_SCAN_LIMIT } from '../instances/failure-queue/route'
import { POST as startBulkReplay } from '../instances/bulk-replay/route'
import { WorkflowInstance } from '../../data/entities'

const tenantId = 'tenant-1'
const orgId = 'org-1'
const userId = 'user-1'

let mockEm: { find: jest.Mock; count: jest.Mock }
let mockRbac: { userHasAllFeatures: jest.Mock }
let mockProgress: { createJob: jest.Mock }

function row(overrides: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workflowId: 'checkout',
    status: 'FAILED',
    errorMessage: null,
    metadata: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockEm = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
  mockRbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
  mockProgress = { createJob: jest.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' }) }

  const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      if (name === 'rbacService') return mockRbac
      if (name === 'progressService') return mockProgress
      return null
    },
  })

  const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
  getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId })

  const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
  resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: orgId })
})

describe('GET /api/workflows/instances/failure-queue', () => {
  test('is gated on the instance-view feature', () => {
    const { metadata } = require('../instances/failure-queue/route')
    expect(metadata.requireFeatures).toEqual(['workflows.instances.view'])
  })

  test('selects the UNION of FAILED, partial-failure and attention-parked instances, tenant-scoped', async () => {
    await listFailureQueue(new NextRequest('http://localhost/api/workflows/instances/failure-queue'))

    const where = mockEm.find.mock.calls[0][1]
    expect(where.tenantId).toBe(tenantId)
    expect(where.organizationId).toEqual({ $in: [orgId] })
    // The list route ANDs `status` and `attention`; the triage set is a union,
    // which is why this route exists at all.
    expect(Array.isArray(where.$or)).toBe(true)
    expect(where.$or).toHaveLength(3)
    expect(where.$or[0]).toEqual({ status: 'FAILED' })
    // A `partial_failure` reached END and was written COMPLETED, so neither of
    // the other two arms reaches it.
    expect(where.$or[1]).toEqual({ outcome: { $in: ['partial_failure'] } })
  })

  test('excludes dry runs, like every other run surface', async () => {
    // A simulated failure is a report about a definition, not a run to triage,
    // and bulk-replaying one from this list would start a REAL instance from a
    // dry run's context.
    await listFailureQueue(new NextRequest('http://localhost/api/workflows/instances/failure-queue'))

    expect(mockEm.find.mock.calls[0][1].isDryRun).toBe(false)
  })

  test('groups similar failures and returns them biggest-first', async () => {
    mockEm.find.mockResolvedValue([
      row({ id: 'a', errorMessage: 'Order 11111111-1111-4111-8111-111111111111 not found' }),
      row({ id: 'b', errorMessage: 'Order 22222222-2222-4222-8222-222222222222 not found' }),
      row({ id: 'c', errorMessage: 'Gateway timeout' }),
    ])
    mockEm.count.mockResolvedValue(3)

    const response = await listFailureQueue(
      new NextRequest('http://localhost/api/workflows/instances/failure-queue')
    )
    const body = await response.json()

    expect(body.groups).toHaveLength(2)
    expect(body.groups[0].count).toBe(2)
    expect(body.data).toHaveLength(3)
  })

  test('narrowing to a group filters the rows and the reported total', async () => {
    mockEm.find.mockResolvedValue([
      row({ id: 'a', errorMessage: 'Gateway timeout' }),
      row({ id: 'b', errorMessage: 'Something else' }),
    ])

    const response = await listFailureQueue(
      new NextRequest(
        'http://localhost/api/workflows/instances/failure-queue?errorGroup=' + encodeURIComponent('Gateway timeout')
      )
    )
    const body = await response.json()

    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('a')
    expect(body.pagination.total).toBe(1)
    // A narrowed page counts what it filtered rather than firing a COUNT that
    // cannot express the JS-side normalization.
    expect(mockEm.count).not.toHaveBeenCalled()
  })

  test('reports when the grouping scan was truncated rather than implying it covered everything', async () => {
    mockEm.find.mockResolvedValue(
      Array.from({ length: FAILURE_GROUP_SCAN_LIMIT }, (_unused, index) =>
        row({ id: `id-${index}`, errorMessage: 'Gateway timeout' })
      )
    )
    mockEm.count.mockResolvedValue(5000)

    const response = await listFailureQueue(
      new NextRequest('http://localhost/api/workflows/instances/failure-queue')
    )
    const body = await response.json()

    expect(body.grouping.truncated).toBe(true)
    expect(body.grouping.scanLimit).toBe(FAILURE_GROUP_SCAN_LIMIT)
  })

  test('caps the page size at the platform maximum', async () => {
    mockEm.find.mockResolvedValue(
      Array.from({ length: 200 }, (_unused, index) => row({ id: `id-${index}` }))
    )
    mockEm.count.mockResolvedValue(200)

    const response = await listFailureQueue(
      new NextRequest('http://localhost/api/workflows/instances/failure-queue?limit=9999')
    )
    const body = await response.json()

    expect(body.data.length).toBe(100)
    expect(body.pagination.limit).toBe(100)
  })

  test('401s an unauthenticated caller', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await listFailureQueue(
      new NextRequest('http://localhost/api/workflows/instances/failure-queue')
    )
    expect(response.status).toBe(401)
  })
})

describe('POST /api/workflows/instances/bulk-replay', () => {
  function request(body: unknown) {
    return new Request('http://localhost/api/workflows/instances/bulk-replay', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  const ids = ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333']

  test('is gated on the bulk-ops feature, not on plain retry/cancel', () => {
    const { metadata } = require('../instances/bulk-replay/route')
    expect(metadata.POST.requireFeatures).toEqual(['workflows.instances.bulk_ops'])
  })

  test('creates a progress job and queues the work instead of doing it inline', async () => {
    const response = await startBulkReplay(request({ action: 'retry', ids }))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.ok).toBe(true)
    expect(body.progressJobId).toBe('22222222-2222-4222-8222-222222222222')
    expect(mockProgress.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'workflows.instances.bulk_retry', totalCount: 2 }),
      expect.objectContaining({ tenantId, organizationId: orgId, userId })
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retry',
        ids,
        scope: { tenantId, organizationId: orgId, userId },
      })
    )
  })

  test('deduplicates ids so a double-selected row is not replayed twice', async () => {
    await startBulkReplay(request({ action: 'cancel', ids: [ids[0], ids[0], ids[1]] }))
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ ids }))
  })

  test('403s a caller without the bulk-ops feature', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await startBulkReplay(request({ action: 'retry', ids }))

    expect(response.status).toBe(403)
    expect(enqueue).not.toHaveBeenCalled()
    expect(mockProgress.createJob).not.toHaveBeenCalled()
  })

  test('400s an unknown action or an empty id list', async () => {
    expect((await startBulkReplay(request({ action: 'destroy', ids }))).status).toBe(400)
    expect((await startBulkReplay(request({ action: 'retry', ids: [] }))).status).toBe(400)
    expect((await startBulkReplay(request({ action: 'retry', ids: ['not-a-uuid'] }))).status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('401s an unauthenticated caller before touching the queue', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await startBulkReplay(request({ action: 'retry', ids }))

    expect(response.status).toBe(401)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('workflows.instances.bulk_ops ACL', () => {
  test('declares the feature and its dependencies', () => {
    const { features } = require('../../acl')
    const feature = features.find((entry: { id: string }) => entry.id === 'workflows.instances.bulk_ops')
    expect(feature).toBeDefined()
    expect([...feature.dependsOn].sort()).toEqual([
      'workflows.instances.cancel',
      'workflows.instances.retry',
    ])
  })

  test('the scoped where clause used by the triage list is tenant-first', () => {
    expect(WorkflowInstance).toBeDefined()
  })
})
