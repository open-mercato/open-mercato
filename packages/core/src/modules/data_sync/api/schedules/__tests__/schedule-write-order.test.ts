/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const mockScheduler = {
  register: jest.fn(),
  unregister: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (...args: unknown[]) => mockFindOneWithDecryption(...args)),
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

function request(scheduleValue = '3600') {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      scheduleType: 'interval',
      scheduleValue,
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
    }),
  })
}

function existingRow(scheduledJobId: string | null) {
  return {
    id: 'schedule-1',
    integrationId: 'sync_excel',
    entityType: 'customers.person',
    direction: 'import' as const,
    scheduleType: 'interval' as const,
    scheduleValue: '30m',
    timezone: 'UTC',
    fullSync: false,
    isEnabled: true,
    scheduledJobId,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('data_sync schedule save write ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockImplementation(async () => null)
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockEm.create.mockImplementation((_entityClass: unknown, data: Record<string, unknown>) => ({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...data,
    }))
    mockEm.persist.mockImplementation(() => undefined)
    mockEm.flush.mockImplementation(async () => undefined)
    mockScheduler.register.mockImplementation(async () => undefined)
    mockScheduler.unregister.mockImplementation(async () => undefined)
  })

  it('does not persist the schedule when the scheduler rejects an unparseable value', async () => {
    mockScheduler.register.mockImplementation(async () => {
      throw new Error('Failed to calculate next run time for schedule: some-id')
    })

    const res = await POST(request())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('Failed to calculate next run time')

    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('registers the scheduled job before flushing the schedule row on the success path', async () => {
    const res = await POST(request('1h'))

    expect(res.status).toBe(201)
    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
    expect(mockScheduler.register.mock.invocationCallOrder[0])
      .toBeLessThan(mockEm.flush.mock.invocationCallOrder[0])
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('unregisters the scheduled job it just created when the schedule row fails to flush', async () => {
    const flushError = new Error('could not serialize access due to concurrent update')
    mockEm.flush.mockImplementation(async () => {
      throw flushError
    })

    const res = await POST(request('1h'))

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe(flushError.message)

    const registeredJobId = mockScheduler.register.mock.calls[0][0].id
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.unregister).toHaveBeenCalledWith(registeredJobId)
  })

  it('leaves an inherited registration alone when the update write fails', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow('job-1'))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('could not serialize access due to concurrent update')
    })

    const res = await POST(request('1h'))

    expect(res.status).toBe(422)
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }))
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('unregisters the registration it minted for a row that had no scheduled job yet', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow(null))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await POST(request('1h'))

    expect(res.status).toBe(422)
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'schedule-1' }))
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.unregister).toHaveBeenCalledWith('schedule-1')
  })

  it('still surfaces the original write failure when the compensating unregister also fails', async () => {
    const flushError = new Error('connection terminated unexpectedly')
    mockEm.flush.mockImplementation(async () => {
      throw flushError
    })
    mockScheduler.unregister.mockImplementation(async () => {
      throw new Error('scheduler unavailable')
    })

    const res = await POST(request('1h'))

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe(flushError.message)
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
  })
})
