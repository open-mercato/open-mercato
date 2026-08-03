import { BullMQSchedulerService } from '../bullmqSchedulerService'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../../data/entities.js'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const mockedLogger = createLogger('scheduler')
const loggerDebug = mockedLogger.debug as jest.Mock
const loggerInfo = mockedLogger.info as jest.Mock
const loggerError = mockedLogger.error as jest.Mock

// Mock BullMQ module
const mockQueue = {
  upsertJobScheduler: jest.fn(),
  getJobSchedulers: jest.fn(),
  removeJobScheduler: jest.fn(),
  close: jest.fn(),
}

const mockLegacyQueue = {
  add: jest.fn(),
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
  close: jest.fn(),
}

let useLegacyQueue = false

const mockQueueConstructor = jest.fn(() => useLegacyQueue ? mockLegacyQueue : mockQueue)

jest.mock('bullmq', () => ({
  Queue: mockQueueConstructor,
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://localhost:6379'),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
}))


describe('BullMQSchedulerService', () => {
  let service: BullMQSchedulerService
  let mockEm: jest.Mocked<EntityManager>
  let mockForkedEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    jest.clearAllMocks()
    useLegacyQueue = false
    mockQueue.upsertJobScheduler.mockResolvedValue({})
    mockQueue.getJobSchedulers.mockResolvedValue([])
    mockQueue.removeJobScheduler.mockResolvedValue(true)
    mockQueue.close.mockResolvedValue(undefined)
    mockLegacyQueue.add.mockResolvedValue({})
    mockLegacyQueue.getRepeatableJobs.mockResolvedValue([])
    mockLegacyQueue.removeRepeatableByKey.mockResolvedValue(true)
    mockLegacyQueue.close.mockResolvedValue(undefined)

    // Create mock forked EM
    mockForkedEm = {
      find: jest.fn(),
    } as any

    // Create mock main EM
    mockEm = {
      fork: jest.fn(() => mockForkedEm),
    } as any

    service = new BullMQSchedulerService(() => mockEm)
  })

  it('constructs BullMQ with parsed ioredis connection fields', async () => {
    const schedule = {
      id: 'test-connection',
      name: 'Test Schedule',
      isEnabled: true,
      scheduleType: 'cron',
      scheduleValue: '0 0 * * *',
      timezone: 'UTC',
      scopeType: 'system',
    } as ScheduledJob

    await service.register(schedule)

    expect(mockQueueConstructor).toHaveBeenCalledWith('scheduler-execution', {
      connection: expect.objectContaining({ host: 'localhost', port: 6379 }),
    })
  })

  describe('register', () => {
    it('falls back to repeatable jobs for BullMQ 5 releases without Job Schedulers', async () => {
      useLegacyQueue = true
      mockLegacyQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-test-legacy', name: 'schedule-test-legacy', key: 'old-key' },
      ])
      const schedule = {
        id: 'test-legacy',
        name: 'Legacy Schedule',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockLegacyQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-key')
      expect(mockLegacyQueue.add).toHaveBeenCalledWith(
        'schedule-test-legacy',
        expect.objectContaining({ id: 'schedule-test-legacy' }),
        expect.objectContaining({ repeat: { pattern: '0 0 * * *', tz: 'UTC' } }),
      )
    })

    it('should skip disabled schedules', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test Schedule',
        isEnabled: false,
      } as ScheduledJob

      await service.register(schedule)

      expect(loggerDebug).toHaveBeenCalledWith(
        'Skipping disabled schedule',
        { scheduleId: 'test-1' }
      )
      expect(mockQueue.upsertJobScheduler).not.toHaveBeenCalled()
    })

    it('should register cron schedule with BullMQ', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test Cron Schedule',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'system',
        tenantId: null,
        organizationId: null,
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'schedule-test-1',
        expect.objectContaining({
          pattern: '0 0 * * *',
          tz: 'UTC',
        }),
        expect.objectContaining({
          name: 'schedule-test-1',
          data: expect.objectContaining({
            id: 'schedule-test-1',
            payload: expect.objectContaining({
              scheduleId: 'test-1',
              scopeType: 'system',
            }),
          }),
        })
      )
    })

    it('should register interval schedule with BullMQ', async () => {
      const schedule = {
        id: 'test-2',
        name: 'Test Interval Schedule',
        isEnabled: true,
        scheduleType: 'interval',
        scheduleValue: '15m',
        timezone: 'UTC',
        scopeType: 'tenant',
        tenantId: 'tenant-1',
        organizationId: null,
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'schedule-test-2',
        expect.objectContaining({
          every: 15 * 60 * 1000,
          tz: 'UTC',
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({
              scheduleId: 'test-2',
              tenantId: 'tenant-1',
              scopeType: 'tenant',
            }),
          }),
        })
      )
    })

    it('should include organization scope in job data', async () => {
      const schedule = {
        id: 'test-3',
        name: 'Test Org Schedule',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'organization',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({
              scheduleId: 'test-3',
              tenantId: 'tenant-1',
              organizationId: 'org-1',
              scopeType: 'organization',
            }),
          }),
        })
      )
    })

    it('should upsert an updated schedule by stable scheduler id', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '*/15 * * * *',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'schedule-test-1',
        expect.objectContaining({
          pattern: '*/15 * * * *',
        }),
        expect.any(Object),
      )
    })

    it('should update nextRunAt when skipNextRunUpdate is false', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'system',
        nextRunAt: new Date('2020-01-01'),
      } as ScheduledJob

      await service.register(schedule, { skipNextRunUpdate: false })

      // nextRunAt should be updated
      expect(schedule.nextRunAt).not.toEqual(new Date('2020-01-01'))
    })

    it('should not update nextRunAt when skipNextRunUpdate is true', async () => {
      const originalDate = new Date('2020-01-01')
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'system',
        nextRunAt: originalDate,
      } as ScheduledJob

      await service.register(schedule, { skipNextRunUpdate: true })

      // nextRunAt should not be updated
      expect(schedule.nextRunAt).toEqual(originalDate)
    })

    it('should throw on BullMQ registration error', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      const error = new Error('BullMQ connection failed')
      mockQueue.upsertJobScheduler.mockRejectedValue(error)

      await expect(service.register(schedule)).rejects.toThrow('BullMQ connection failed')

      expect(loggerError).toHaveBeenCalledWith(
        'Failed to register schedule',
        { scheduleId: 'test-1', err: error }
      )
    })

    it('should throw on invalid cron expression', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: 'invalid-cron',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await expect(service.register(schedule)).rejects.toThrow()
    })

    it('should throw on invalid interval', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'interval',
        scheduleValue: 'invalid',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await expect(service.register(schedule)).rejects.toThrow()
    })
  })

  describe('unregister', () => {
    it('removes legacy BullMQ 5 repeatable jobs when Job Schedulers are unavailable', async () => {
      useLegacyQueue = true
      mockLegacyQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-test-legacy', name: 'schedule-test-legacy', key: 'legacy-key' },
      ])

      await service.unregister('test-legacy')

      expect(mockLegacyQueue.removeRepeatableByKey).toHaveBeenCalledWith('legacy-key')
      expect(loggerDebug).toHaveBeenCalledWith('Unregistered schedule', {
        scheduleId: 'test-legacy',
      })
    })

    it('should remove a job scheduler by stable id', async () => {
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'schedule-test-1', name: 'schedule-test-1', key: 'schedule-test-1' },
        { id: 'schedule-test-2', name: 'schedule-test-2', key: 'schedule-test-2' },
      ])

      await service.unregister('test-1')

      expect(mockQueue.getJobSchedulers).toHaveBeenCalled()
      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith('schedule-test-1')
      expect(loggerDebug).toHaveBeenCalledWith(
        'Unregistered schedule',
        { scheduleId: 'test-1' }
      )
    })

    it('should handle schedule not found', async () => {
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'schedule-other', name: 'schedule-other', key: 'schedule-other' },
      ])

      await service.unregister('test-1')

      expect(mockQueue.removeJobScheduler).not.toHaveBeenCalled()
      expect(loggerDebug).toHaveBeenCalledWith(
        'No job scheduler found for schedule',
        { scheduleId: 'test-1' }
      )
    })

    it('should match by scheduler key if id is not present', async () => {
      mockQueue.getJobSchedulers.mockResolvedValue([
        { name: 'test', key: 'schedule-test-1' },
      ])

      await service.unregister('test-1')

      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith('schedule-test-1')
    })

    it('should throw on BullMQ error', async () => {
      const error = new Error('BullMQ error')
      mockQueue.getJobSchedulers.mockRejectedValue(error)

      await expect(service.unregister('test-1')).rejects.toThrow('BullMQ error')

      expect(loggerError).toHaveBeenCalledWith(
        'Failed to unregister schedule',
        { scheduleId: 'test-1', err: error }
      )
    })
  })

  describe('syncAll', () => {
    it('should register missing schedules', async () => {
      const dbSchedules = [
        { id: 'schedule-1', name: 'Schedule 1', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
        { id: 'schedule-2', name: 'Schedule 2', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'schedule-schedule-1', name: 'schedule-schedule-1', key: 'schedule-schedule-1' },
      ])

      await service.syncAll()

      expect(mockForkedEm.find).toHaveBeenCalledWith(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
      }, { limit: 500, offset: 0 })
      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'schedule-schedule-2',
        expect.any(Object),
        expect.any(Object)
      )
      expect(loggerDebug).toHaveBeenCalledWith(
        'Registering missing schedule',
        { scheduleId: 'schedule-2', scheduleName: 'Schedule 2' }
      )
    })

    it('should clamp a legacy sub-minute schedule and continue registering the batch', async () => {
      const dbSchedules = [
        { id: 'legacy', name: 'Legacy', isEnabled: true, scheduleType: 'interval', scheduleValue: '10s', timezone: 'UTC', scopeType: 'system' },
        { id: 'current', name: 'Current', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getJobSchedulers.mockResolvedValue([])

      await service.syncAll()

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledTimes(2)
      expect(mockQueue.upsertJobScheduler).toHaveBeenNthCalledWith(
        1,
        'schedule-legacy',
        expect.objectContaining({
          every: 60 * 1000,
          tz: 'UTC',
        }),
        expect.any(Object),
      )
      expect(mockQueue.upsertJobScheduler).toHaveBeenNthCalledWith(
        2,
        'schedule-current',
        expect.objectContaining({
          pattern: '0 0 * * *',
          tz: 'UTC',
        }),
        expect.any(Object),
      )
    })

    it('should remove orphaned BullMQ jobs', async () => {
      const dbSchedules = [
        { id: 'schedule-1', name: 'Schedule 1', isEnabled: true },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'schedule-schedule-1', name: 'schedule-schedule-1', key: 'schedule-schedule-1' },
        { id: 'schedule-schedule-2', name: 'schedule-schedule-2', key: 'schedule-schedule-2' },
      ])

      await service.syncAll()

      expect(mockQueue.removeJobScheduler).toHaveBeenCalledWith('schedule-schedule-2')
      expect(loggerInfo).toHaveBeenCalledWith(
        'Removing orphaned schedule',
        { scheduleId: 'schedule-2' }
      )
    })

    it('should leave existing job schedulers unchanged', async () => {
      const dbSchedules = [
        { id: 'schedule-1', name: 'Schedule 1', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getJobSchedulers.mockResolvedValue([
        { id: 'schedule-schedule-1', name: 'schedule-schedule-1', key: 'schedule-schedule-1' },
      ])

      await service.syncAll()

      expect(mockQueue.upsertJobScheduler).not.toHaveBeenCalled()
      expect(mockQueue.removeJobScheduler).not.toHaveBeenCalled()
    })

    it('should log sync completion', async () => {
      mockForkedEm.find.mockResolvedValue([])
      mockQueue.getJobSchedulers.mockResolvedValue([])

      await service.syncAll()

      expect(loggerDebug).toHaveBeenCalledWith('Starting full sync')
      expect(loggerDebug).toHaveBeenCalledWith(
        'Sync complete',
        { activeSchedules: 0 }
      )
    })
  })

  describe('getRepeatableJobs', () => {
    it('should return job schedulers', async () => {
      const jobs = [
        { id: 'schedule-1', name: 'schedule-1', key: 'schedule-1' },
        { id: 'schedule-2', name: 'schedule-2', key: 'schedule-2' },
      ]

      mockQueue.getJobSchedulers.mockResolvedValue(jobs)

      const result = await service.getRepeatableJobs()

      expect(result).toEqual(jobs)
      expect(mockQueue.getJobSchedulers).toHaveBeenCalled()
    })

    it('should return empty array on error', async () => {
      mockQueue.getJobSchedulers.mockRejectedValue(new Error('BullMQ error'))

      const result = await service.getRepeatableJobs()

      expect(result).toEqual([])
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to get job schedulers',
        { err: expect.any(Error) }
      )
    })
  })

  describe('buildRepeatOptions', () => {
    it('should build cron repeat options', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'America/New_York',
        scopeType: 'system',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          pattern: '0 0 * * *',
          tz: 'America/New_York',
        }),
        expect.any(Object),
      )
    })

    it('should build interval repeat options', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'interval',
        scheduleValue: '2h',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          every: 2 * 60 * 60 * 1000,
          tz: 'UTC',
        }),
        expect.any(Object),
      )
    })

    it('should default timezone to UTC', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: null as any,
        scopeType: 'system',
        targetType: 'queue',
        targetQueue: 'test',
      } as ScheduledJob

      await service.register(schedule)

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          pattern: '0 0 * * *',
          tz: 'UTC',
        }),
        expect.any(Object),
      )
    })

    it('should throw on unsupported schedule type', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test',
        isEnabled: true,
        scheduleType: 'unknown' as any,
        scheduleValue: 'whatever',
        timezone: 'UTC',
        scopeType: 'system',
      } as ScheduledJob

      await expect(service.register(schedule)).rejects.toThrow('Unsupported schedule type: unknown')
    })
  })
})
