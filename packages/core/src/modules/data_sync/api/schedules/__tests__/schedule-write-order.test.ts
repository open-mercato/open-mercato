/** @jest-environment node */

import { createInvalidScheduleValueError } from '@open-mercato/shared/lib/schedule/invalidScheduleValue'

const mockGetAuthFromRequest = jest.fn()
const mockLoggerError = jest.fn()
const mockReportError = jest.fn()

const mockEm = {
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const mockScheduler = {
  register: jest.fn(),
  unregister: jest.fn(),
  exists: jest.fn(),
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

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(() => ({ reportError: mockReportError })),
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
import { PUT } from '../[id]/route'

const updateRouteScheduleId = '3f8b1f1e-2c3d-4a5b-8c7d-9e0f1a2b3c4d'

function updateRequest(scheduleValue = '1h') {
  return new Request(`http://localhost/api/data_sync/schedules/${updateRouteScheduleId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheduleValue }),
  })
}

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

function saveInput() {
  return {
    integrationId: 'sync_excel',
    entityType: 'customers.person',
    direction: 'import' as const,
    scheduleType: 'interval' as const,
    scheduleValue: '1h',
    timezone: 'UTC',
    fullSync: false,
    isEnabled: true,
  }
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

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      scheduleType: 'interval',
      scheduleValue: '1h',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
      ...overrides,
    }),
  })
}

describe('data_sync schedule save write ordering', () => {
  const invalidCron = { scheduleType: 'cron', scheduleValue: 'not a cron' }

  function rejectInvalidCron() {
    mockScheduler.register.mockImplementation(async () => {
      throw createInvalidScheduleValueError(
        'cron',
        'not a cron',
        'Failed to calculate next run time for schedule: some-id',
      )
    })
  }

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
    mockScheduler.exists.mockImplementation(async () => false)
  })

  it('does not persist the schedule when the scheduler rejects an unparseable value', async () => {
    rejectInvalidCron()

    const res = await POST(request(invalidCron))

    expect(res.status).toBe(422)

    expect(mockScheduler.register).toHaveBeenCalledTimes(1)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('reports a scheduler-rejected value as a scheduleValue field error instead of the internal message', async () => {
    rejectInvalidCron()

    const res = await POST(request(invalidCron))
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

  it('registers the scheduled job before flushing the schedule row on the success path', async () => {
    const res = await POST(request())

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

    const res = await POST(request())

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

    const res = await POST(request())

    expect(res.status).toBe(422)
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }))
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('unregisters the registration it minted for a row that had no scheduled job yet', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow(null))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await POST(request())

    expect(res.status).toBe(422)
    expect(mockScheduler.exists).toHaveBeenCalledWith('schedule-1')
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'schedule-1' }))
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.unregister).toHaveBeenCalledWith('schedule-1')
  })

  it('leaves a job that already lived at the row id alone when the update write fails', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow(null))
    mockScheduler.exists.mockImplementation(async () => true)
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await POST(request())

    expect(res.status).toBe(422)
    expect(mockScheduler.exists).toHaveBeenCalledWith('schedule-1')
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'schedule-1' }))
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
  })

  it('does not query the scheduler for a freshly minted id on the create path', async () => {
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await POST(request())

    expect(res.status).toBe(422)
    expect(mockScheduler.exists).not.toHaveBeenCalled()
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
  })

  it('compensates as before when the scheduler cannot answer whether the job exists', async () => {
    const schedulerWithoutExists = {
      register: jest.fn(async () => undefined),
      unregister: jest.fn(async () => undefined),
    }
    const service = createSyncScheduleService(mockEm, schedulerWithoutExists)
    mockFindOneWithDecryption.mockImplementation(async () => existingRow(null))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    await expect(service.saveSchedule(saveInput(), scope)).rejects.toThrow('connection terminated unexpectedly')

    expect(schedulerWithoutExists.unregister).toHaveBeenCalledTimes(1)
    expect(schedulerWithoutExists.unregister).toHaveBeenCalledWith('schedule-1')
  })

  it('still surfaces the original write failure when the compensating unregister also fails', async () => {
    const flushError = new Error('connection terminated unexpectedly')
    mockEm.flush.mockImplementation(async () => {
      throw flushError
    })
    mockScheduler.unregister.mockImplementation(async () => {
      throw new Error('scheduler unavailable')
    })

    const res = await POST(request())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe(flushError.message)
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
  })

  it('logs the orphaned scheduled job when the compensating unregister fails', async () => {
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })
    const compensationError = new Error('scheduler unavailable')
    mockScheduler.unregister.mockImplementation(async () => {
      throw compensationError
    })

    await POST(request())

    const registeredJobId = mockScheduler.register.mock.calls[0][0].id
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unregister the scheduled job'),
      expect.objectContaining({
        scheduledJobId: registeredJobId,
        scheduleId: registeredJobId,
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        err: compensationError,
      }),
    )
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      compensationError,
      expect.objectContaining({
        module: 'data_sync',
        code: 'data_sync.schedule_save_compensation_failed',
        attributes: expect.objectContaining({
          scheduledJobId: registeredJobId,
          scheduleId: registeredJobId,
          organizationId: 'org-1',
          tenantId: 'tenant-1',
        }),
      }),
    )
  })

  it('unregisters the registration it minted when the update route fails to flush', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow(null))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await PUT(updateRequest(), { params: { id: updateRouteScheduleId } })

    expect(res.status).toBe(422)
    expect(mockScheduler.exists).toHaveBeenCalledWith('schedule-1')
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'schedule-1' }))
    expect(mockScheduler.unregister).toHaveBeenCalledTimes(1)
    expect(mockScheduler.unregister).toHaveBeenCalledWith('schedule-1')
  })

  it('leaves an inherited registration alone when the update route fails to flush', async () => {
    mockFindOneWithDecryption.mockImplementation(async () => existingRow('job-1'))
    mockEm.flush.mockImplementation(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const res = await PUT(updateRequest(), { params: { id: updateRouteScheduleId } })

    expect(res.status).toBe(422)
    expect(mockScheduler.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }))
    expect(mockScheduler.unregister).not.toHaveBeenCalled()
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
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('does not mask the original error when the compensation register also fails', async () => {
    const row = makeRow()
    mockFindOneWithDecryption.mockResolvedValueOnce(row)
    const flushError = new Error('connection lost')
    mockEm.flush.mockRejectedValueOnce(flushError)
    mockScheduler.unregister.mockResolvedValueOnce(undefined)
    const compensationError = new Error('scheduler unavailable')
    mockScheduler.register.mockRejectedValueOnce(compensationError)

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
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      compensationError,
      expect.objectContaining({
        module: 'data_sync',
        code: 'data_sync.schedule_delete_compensation_failed',
        attributes: expect.objectContaining({
          scheduledJobId: 'job-1',
          scheduleId: 'schedule-1',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        }),
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
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
