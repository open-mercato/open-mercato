import { BullMQSchedulerService } from '../bullmqSchedulerService'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../../data/entities.js'

// Mock BullMQ module
const mockQueue = {
  add: jest.fn(),
  getRepeatableJobs: jest.fn(),
  removeRepeatableByKey: jest.fn(),
}

const mockQueueConstructor = jest.fn(() => mockQueue)

jest.mock('bullmq', () => ({
  Queue: mockQueueConstructor,
}))



describe('BullMQSchedulerService', () => {
  let service: BullMQSchedulerService
  let mockEm: jest.Mocked<EntityManager>
  let mockForkedEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    jest.clearAllMocks()

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

  describe('register', () => {
    it('should skip disabled schedules', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test Schedule',
        isEnabled: false,
      } as ScheduledJob

      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation()

      await service.register(schedule)

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Skipping disabled schedule: test-1'
      )
      expect(mockQueue.add).not.toHaveBeenCalled()

      consoleDebugSpy.mockRestore()
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

      mockQueue.add.mockResolvedValue({})

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        'schedule-test-1',
        expect.objectContaining({
          id: 'schedule-test-1',
          payload: expect.objectContaining({
            scheduleId: 'test-1',
            scopeType: 'system',
          }),
        }),
        expect.objectContaining({
          repeat: expect.objectContaining({
            pattern: '0 0 * * *',
            tz: 'UTC',
          }),
        })
      )

      consoleLogSpy.mockRestore()
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

      mockQueue.add.mockResolvedValue({})

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        'schedule-test-2',
        expect.objectContaining({
          payload: expect.objectContaining({
            scheduleId: 'test-2',
            tenantId: 'tenant-1',
            scopeType: 'tenant',
          }),
        }),
        expect.objectContaining({
          repeat: expect.objectContaining({
            every: 15 * 60 * 1000, // 15 minutes in ms
            tz: 'UTC',
          }),
        })
      )

      consoleLogSpy.mockRestore()
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

      mockQueue.add.mockResolvedValue({})

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.objectContaining({
            scheduleId: 'test-3',
            tenantId: 'tenant-1',
            organizationId: 'org-1',
            scopeType: 'organization',
          }),
        }),
        expect.any(Object)
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

      mockQueue.add.mockResolvedValue({})

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

      mockQueue.add.mockResolvedValue({})

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
      mockQueue.add.mockRejectedValue(error)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await expect(service.register(schedule)).rejects.toThrow('BullMQ connection failed')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Failed to register schedule: test-1',
        error
      )

      consoleErrorSpy.mockRestore()
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
    it('should remove repeatable job by key', async () => {
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-test-1', name: 'schedule-test-1', key: 'key-1' },
        { id: 'schedule-test-2', name: 'schedule-test-2', key: 'key-2' },
      ])
      mockQueue.removeRepeatableByKey.mockResolvedValue(true)

      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation()

      await service.unregister('test-1')

      expect(mockQueue.getRepeatableJobs).toHaveBeenCalled()
      expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('key-1')
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Unregistered schedule: test-1'
      )

      consoleDebugSpy.mockRestore()
    })

    it('should handle schedule not found', async () => {
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-other', name: 'schedule-other', key: 'key-1' },
      ])

      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation()

      await service.unregister('test-1')

      expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalled()
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] No repeatable job found for schedule: test-1'
      )

      consoleDebugSpy.mockRestore()
    })

    it('should match by name if id is not present', async () => {
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { name: 'schedule-test-1', key: 'key-1' }, // No id field
      ])
      mockQueue.removeRepeatableByKey.mockResolvedValue(true)

      await service.unregister('test-1')

      expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('key-1')
    })

    it('should throw on BullMQ error', async () => {
      const error = new Error('BullMQ error')
      mockQueue.getRepeatableJobs.mockRejectedValue(error)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await expect(service.unregister('test-1')).rejects.toThrow('BullMQ error')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Failed to unregister schedule: test-1',
        error
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('syncAll', () => {
    it('should register missing schedules', async () => {
      const dbSchedules = [
        { id: 'schedule-1', name: 'Schedule 1', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
        { id: 'schedule-2', name: 'Schedule 2', isEnabled: true, scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', scopeType: 'system' },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-schedule-1', name: 'schedule-schedule-1', key: 'key-1' },
      ])
      mockQueue.add.mockResolvedValue({})

      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation()

      await service.syncAll()

      expect(mockForkedEm.find).toHaveBeenCalledWith(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
      }, { limit: 500, offset: 0 })
      expect(mockQueue.add).toHaveBeenCalledWith(
        'schedule-schedule-2',
        expect.any(Object),
        expect.any(Object)
      )
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Registering missing schedule: Schedule 2'
      )

      consoleDebugSpy.mockRestore()
    })

    it('should remove orphaned BullMQ jobs', async () => {
      const dbSchedules = [
        { id: 'schedule-1', name: 'Schedule 1', isEnabled: true },
      ] as ScheduledJob[]

      mockForkedEm.find.mockResolvedValue(dbSchedules)
      mockQueue.getRepeatableJobs.mockResolvedValue([
        { id: 'schedule-schedule-1', name: 'schedule-schedule-1', key: 'key-1' },
        { id: 'schedule-schedule-2', name: 'schedule-schedule-2', key: 'key-2' },
      ])
      mockQueue.removeRepeatableByKey.mockResolvedValue(true)

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.syncAll()

      expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('key-2')
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Removing orphaned schedule: schedule-2'
      )

      consoleLogSpy.mockRestore()
    })

    it('should log sync completion', async () => {
      mockForkedEm.find.mockResolvedValue([])
      mockQueue.getRepeatableJobs.mockResolvedValue([])

      const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation()

      await service.syncAll()

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Starting full sync...'
      )
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Sync complete - 0 schedules active'
      )

      consoleDebugSpy.mockRestore()
    })
  })

  describe('getRepeatableJobs', () => {
    it('should return repeatable jobs', async () => {
      const jobs = [
        { id: 'schedule-1', key: 'key-1' },
        { id: 'schedule-2', key: 'key-2' },
      ]

      mockQueue.getRepeatableJobs.mockResolvedValue(jobs)

      const result = await service.getRepeatableJobs()

      expect(result).toEqual(jobs)
      expect(mockQueue.getRepeatableJobs).toHaveBeenCalled()
    })

    it('should return empty array on error', async () => {
      mockQueue.getRepeatableJobs.mockRejectedValue(new Error('BullMQ error'))

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const result = await service.getRepeatableJobs()

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[scheduler:bullmq] Failed to get repeatable jobs:',
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
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

      mockQueue.add.mockResolvedValue({})

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            pattern: '0 0 * * *',
            tz: 'America/New_York',
          },
        })
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

      mockQueue.add.mockResolvedValue({})

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            every: 2 * 60 * 60 * 1000, // 2 hours in ms
            tz: 'UTC',
          },
        })
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

      mockQueue.add.mockResolvedValue({})

      await service.register(schedule)

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            pattern: '0 0 * * *',
            tz: 'UTC',
          },
        })
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
