/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockLoggerError = jest.fn()

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

const mockFindOneWithDecryption = jest.fn(async () => null as unknown)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findAndCountWithDecryption: jest.fn(async () => [[], 0]),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((req: Request) => req.json()),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => ({
    child: jest.fn(() => ({ error: mockLoggerError })),
  })),
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

describe('data_sync schedule delete compensation', () => {
  const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

  function makeRow() {
    return {
      id: 'schedule-1',
      scheduledJobId: 'job-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import' as const,
      scheduleType: 'interval' as const,
      scheduleValue: '3600',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      updatedAt: null,
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('re-registers the job and still propagates the original error when the flush fails', async () => {
    const row = makeRow()
    mockFindOneWithDecryption.mockResolvedValueOnce(row)
    const flushError = new Error('connection lost')
    mockEm.flush.mockRejectedValueOnce(flushError)
    mockScheduler.unregister.mockResolvedValueOnce(undefined)
    mockScheduler.register.mockResolvedValueOnce(undefined)

    await expect(scheduleService.deleteSchedule(row.id, scope)).rejects.toThrow('connection lost')

    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.unregister).toHaveBeenCalledWith('job-1')
    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1',
      isEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '3600',
      timezone: 'UTC',
    }))
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('does not mask the original error when the compensation register also fails', async () => {
    const row = makeRow()
    mockFindOneWithDecryption.mockResolvedValueOnce(row)
    const flushError = new Error('connection lost')
    mockEm.flush.mockRejectedValueOnce(flushError)
    mockScheduler.unregister.mockResolvedValueOnce(undefined)
    mockScheduler.register.mockRejectedValueOnce(new Error('scheduler unavailable'))

    await expect(scheduleService.deleteSchedule(row.id, scope)).rejects.toThrow('connection lost')

    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to restore scheduled job after a failed schedule delete',
      expect.objectContaining({
        scheduledJobId: 'job-1',
        scheduleId: 'schedule-1',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      }),
    )
  })

  it('does not re-register the job when the delete succeeds', async () => {
    const row = makeRow()
    mockFindOneWithDecryption.mockResolvedValueOnce(row)
    mockEm.flush.mockResolvedValueOnce(undefined)
    mockScheduler.unregister.mockResolvedValueOnce(undefined)

    await expect(scheduleService.deleteSchedule(row.id, scope)).resolves.toBe(true)

    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.register).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })
})
