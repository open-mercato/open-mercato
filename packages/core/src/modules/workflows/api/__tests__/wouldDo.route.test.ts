/**
 * "Would do" report read surface (spec section 8.2).
 *
 * What a reviewer cannot verify by eye: the report is scoped to the caller's
 * tenant, it only ever reads the dry-run event types (never the whole run log),
 * a real run answers empty rather than 404, and the page cap holds.
 */

import { NextRequest } from 'next/server'
import { GET as getWouldDo, WOULD_DO_PAGE_SIZE_MAX } from '../instances/[id]/would-do/route'
import { WorkflowEvent } from '../../data/entities'
import { DRY_RUN_EVENT_TYPES } from '../../lib/dry-run'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const testTenantId = 'tenant-1'
const testOrgId = 'org-1'
const testInstanceId = '11111111-1111-4111-8111-111111111111'

function makeContext() {
  return { params: Promise.resolve({ id: testInstanceId }) }
}

function makeRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/would-do${query}`)
}

describe('GET /api/workflows/instances/[id]/would-do', () => {
  let mockEm: {
    findOne: jest.Mock
    find: jest.Mock
    findAndCount: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = {
      findOne: jest.fn().mockResolvedValue({ id: testInstanceId, tenantId: testTenantId, isDryRun: true }),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? mockEm : null),
    })

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: testTenantId, orgId: testOrgId })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
  })

  test('is gated on the instance-view feature', () => {
    const { metadata } = require('../instances/[id]/would-do/route')
    expect(metadata.requireFeatures).toEqual(['workflows.instances.view'])
  })

  test('scopes the instance lookup and the event query to the caller tenant', async () => {
    await getWouldDo(makeRequest(), makeContext())

    expect(mockEm.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: testInstanceId, tenantId: testTenantId })
    )
    const [entity, where] = mockEm.findAndCount.mock.calls[0]
    expect(entity).toBe(WorkflowEvent)
    expect(where).toMatchObject({ workflowInstanceId: testInstanceId, tenantId: testTenantId })
  })

  test('reads only the dry-run event types, never the whole run log', async () => {
    await getWouldDo(makeRequest(), makeContext())

    const [, where] = mockEm.findAndCount.mock.calls[0]
    expect(where.eventType.$in.sort()).toEqual(
      [
        DRY_RUN_EVENT_TYPES.activityRefused,
        DRY_RUN_EVENT_TYPES.activitySimulated,
        DRY_RUN_EVENT_TYPES.businessRuleActionsSuppressed,
        DRY_RUN_EVENT_TYPES.userTaskSimulated,
      ].sort()
    )
    expect(where.eventType.$in).not.toContain('STEP_ENTERED')
  })

  test('a real run answers an empty report rather than 404', async () => {
    mockEm.findOne.mockResolvedValue({ id: testInstanceId, tenantId: testTenantId, isDryRun: false })

    const response = await getWouldDo(makeRequest(), makeContext())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ isDryRun: false, entries: [], stoppedByRefusal: false })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('404s an instance outside the caller scope', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const response = await getWouldDo(makeRequest(), makeContext())
    expect(response.status).toBe(404)
  })

  test('resolves each entry back to its definition stepId so the canvas can be addressed', async () => {
    mockEm.findAndCount.mockResolvedValue([
      [
        {
          id: 'event-1',
          eventType: DRY_RUN_EVENT_TYPES.activitySimulated,
          stepInstanceId: 'step-instance-1',
          occurredAt: new Date('2026-07-29T10:00:00.000Z'),
          eventData: { activityType: 'SEND_EMAIL', output: { sent: false } },
        },
        {
          id: 'event-2',
          eventType: DRY_RUN_EVENT_TYPES.activityRefused,
          stepInstanceId: 'step-instance-2',
          occurredAt: new Date('2026-07-29T10:00:01.000Z'),
          eventData: { activityType: 'CALL_API', reason: 'refused' },
        },
      ],
      2,
    ])
    mockEm.find.mockResolvedValue([
      { id: 'step-instance-1', stepId: 'notify' },
      { id: 'step-instance-2', stepId: 'charge' },
    ])

    const response = await getWouldDo(makeRequest(), makeContext())
    const payload = await response.json()

    expect(payload.isDryRun).toBe(true)
    expect(payload.entries.map((entry: { stepId: string }) => entry.stepId)).toEqual(['notify', 'charge'])
    expect(payload.stoppedByRefusal).toBe(true)
  })

  test('caps the page size at the platform maximum', async () => {
    await getWouldDo(makeRequest('?limit=5000'), makeContext())

    const [, , options] = mockEm.findAndCount.mock.calls[0]
    expect(options.limit).toBe(WOULD_DO_PAGE_SIZE_MAX)
  })
})
