/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  create: jest.fn((_entityClass: unknown, data: Record<string, unknown>) => ({ ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockScheduler = {
  register: jest.fn(async () => {
    throw new Error('Failed to calculate next run time for schedule: some-id')
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

function request() {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      scheduleType: 'interval',
      scheduleValue: '3600',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
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
    const body = await res.json()
    expect(body.error).toContain('Failed to calculate next run time')

    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})
