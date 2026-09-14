/** @jest-environment node */

import { createInvalidScheduleValueError } from '@open-mercato/shared/lib/schedule/invalidScheduleValue'

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  create: jest.fn((_entityClass: unknown, data: Record<string, unknown>) => ({ ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockScheduler = {
  register: jest.fn(async () => {
    throw createInvalidScheduleValueError(
      'cron',
      'not a cron',
      'Failed to calculate next run time for schedule: some-id',
    )
  }),
  unregister: jest.fn(async () => undefined),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
  findAndCountWithDecryption: jest.fn(async () => [[], 0]),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((req: Request) => req.json()),
}))

const { createSyncScheduleService } = jest.requireActual('../../../lib/sync-schedule-service')

const scheduleService = createSyncScheduleService(mockEm, mockScheduler)

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'dataSyncScheduleService') return scheduleService
    if (token === 'commandOptimisticLockGuardService') return null
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { POST } from '../route'

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: 'not a cron',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
      ...overrides,
    }),
  })
}

describe('data_sync schedule save write ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
  })

  it('does not persist the schedule when the scheduler rejects an unparseable value', async () => {
    const res = await POST(request())

    expect(res.status).toBe(422)

    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('reports a scheduler-rejected value as a scheduleValue field error instead of the internal message', async () => {
    const res = await POST(request())
    const body = await res.json()

    expect(body.error).toBe('Invalid payload')
    expect(body.details.fieldErrors.scheduleValue).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('Failed to calculate next run time')
    expect(JSON.stringify(body)).not.toContain('some-id')
  })

  it('rejects an unparseable interval at the schema layer, before the scheduler is reached', async () => {
    const res = await POST(request({ scheduleType: 'interval', scheduleValue: '3600' }))

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Invalid payload')
    expect(body.details.fieldErrors.scheduleValue).toHaveLength(1)

    expect(mockScheduler.register).not.toHaveBeenCalled()
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})
