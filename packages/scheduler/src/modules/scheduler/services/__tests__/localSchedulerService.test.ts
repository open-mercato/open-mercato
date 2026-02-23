import { LocalSchedulerService } from '../localSchedulerService'
import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import { ScheduledJob } from '../../data/entities.js'

// Mock the typed event emitter
const mockEmitSchedulerEvent = jest.fn()
jest.mock('../../events.js', () => ({
  emitSchedulerEvent: (...args: unknown[]) => mockEmitSchedulerEvent(...args),
}))

// Mock getGlobalEventBus for command context resolution
jest.mock('@open-mercato/shared/modules/events', () => ({
  getGlobalEventBus: jest.fn().mockReturnValue({ emit: jest.fn() }),
}))

// Mock LocalLockStrategy
jest.mock('../../lib/localLockStrategy', () => ({
  LocalLockStrategy: jest.fn().mockImplementation(() => ({
    tryLock: jest.fn(),
    unlock: jest.fn(),
  })),
}))

// Mock CommandBus
const mockCommandBusInstance = {
  execute: jest.fn(),
}
jest.mock('@open-mercato/shared/lib/commands', () => ({
  CommandBus: jest.fn().mockImplementation(() => mockCommandBusInstance),
}))

describe('LocalSchedulerService', () => {
  let service: LocalSchedulerService
  let mockEm: jest.Mocked<EntityManager>
  let mockForkedEm: jest.Mocked<EntityManager>
  let mockQueue: jest.Mocked<Queue>
  let mockQueueFactory: jest.Mock
  let mockRbacService: { tenantHasFeature: jest.Mock }
  let mockLockStrategy: { tryLock: jest.Mock; unlock: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Create mock queue
    mockQueue = {
      enqueue: jest.fn(),
    } as any

    // Create mock queue factory
    mockQueueFactory = jest.fn(() => mockQueue)

    // Create mock forked EM
    mockForkedEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      flush: jest.fn(),
    } as any

    // Create mock main EM
    mockEm = {
      fork: jest.fn(() => mockForkedEm),
    } as any

    // Create mock RBAC service
    mockRbacService = {
      tenantHasFeature: jest.fn(),
    }

    // Create service
    service = new LocalSchedulerService(
      () => mockEm,
      mockQueueFactory,
      mockRbacService,
      { pollIntervalMs: 1000 }
    )

    // Get reference to mocked lock strategy
    const { LocalLockStrategy } = require('../../lib/localLockStrategy')
    mockLockStrategy = (LocalLockStrategy as jest.Mock).mock.results[0].value
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('start', () => {
    it('should start polling engine', async () => {
      mockForkedEm.find.mockResolvedValue([])

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] Starting polling engine...')
      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] Poll interval: 1000ms')
      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] ✓ Polling engine started')

      consoleLogSpy.mockRestore()
    })

    it('should run initial poll immediately', async () => {
      mockForkedEm.find.mockResolvedValue([])

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(mockForkedEm.find).toHaveBeenCalledWith(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
        nextRunAt: { $lte: expect.any(Date) },
      }, {
        limit: 100,
        orderBy: { nextRunAt: 'ASC' },
      })

      consoleLogSpy.mockRestore()
    })

    it('should not start if already running', async () => {
      mockForkedEm.find.mockResolvedValue([])

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      await service.start()
      await service.start()

      expect(consoleWarnSpy).toHaveBeenCalledWith('[scheduler:local] Already running')

      consoleWarnSpy.mockRestore()
    })

    it('should schedule recurring polls', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()

      // Advance time by poll interval
      mockForkedEm.find.mockClear()
      jest.advanceTimersByTime(1000)

      // Wait for async poll to complete
      await Promise.resolve()

      expect(mockForkedEm.find).toHaveBeenCalled()
    })
  })

  describe('stop', () => {
    it('should stop polling engine', async () => {
      mockForkedEm.find.mockResolvedValue([])

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()
      await service.stop()

      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] Stopping polling engine...')
      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] ✓ Polling engine stopped')

      consoleLogSpy.mockRestore()
    })

    it('should clear poll timer', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()

      // Clear mock and advance time
      mockForkedEm.find.mockClear()
      await service.stop()

      jest.advanceTimersByTime(1000)

      // Poll should not run after stop
      expect(mockForkedEm.find).not.toHaveBeenCalled()
    })
  })

  describe('poll', () => {
    it('should find and execute due schedules', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Test Schedule',
        isEnabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: 'test-queue',
        scopeType: 'system',
        nextRunAt: new Date(Date.now() - 1000),
      } as ScheduledJob

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] Found 1 due schedule(s)')

      consoleLogSpy.mockRestore()
    })

    it('should log when no schedules are due', async () => {
      mockForkedEm.find.mockResolvedValue([])

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(consoleLogSpy).toHaveBeenCalledWith('[scheduler:local] No due schedules')

      consoleLogSpy.mockRestore()
    })

    it('should handle poll errors gracefully', async () => {
      const error = new Error('Database error')
      mockForkedEm.find.mockRejectedValue(error)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(consoleErrorSpy).toHaveBeenCalledWith('[scheduler:local] Poll failed:', error)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('executeSchedule', () => {
    const createSchedule = (overrides = {}): ScheduledJob => ({
      id: 'test-1',
      name: 'Test Schedule',
      isEnabled: true,
      scheduleType: 'cron',
      scheduleValue: '0 0 * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'test-queue',
      scopeType: 'system',
      tenantId: null,
      organizationId: null,
      requireFeature: null,
      targetPayload: null,
      ...overrides,
    } as ScheduledJob)

    it('should skip if lock cannot be acquired', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockLockStrategy.tryLock.mockResolvedValue(false)

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[scheduler:local] Schedule Test Schedule is already locked, skipping'
      )
      expect(mockEmitSchedulerEvent).not.toHaveBeenCalled()

      consoleLogSpy.mockRestore()
    })

    it('should execute queue target', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'test-1',
          scheduleName: 'Test Schedule',
          scopeType: 'system',
        })
      )
    })

    it('should execute command target', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: 'test:command',
        targetQueue: null,
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockCommandBusInstance.execute.mockResolvedValue({ success: true })

      await service.start()

      expect(mockCommandBusInstance.execute).toHaveBeenCalledWith(
        'test:command',
        expect.objectContaining({
          input: expect.objectContaining({
            tenantId: null,
            organizationId: null,
          }),
        })
      )
    })

    it('should emit started event', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.started',
        expect.objectContaining({
          id: 'test-1',
          scheduleName: 'Test Schedule',
          triggerType: 'scheduled',
        })
      )
    })

    it('should emit completed event on success', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.completed',
        expect.objectContaining({
          id: 'test-1',
          scheduleName: 'Test Schedule',
        })
      )
    })

    it('should emit failed event on error', async () => {
      const schedule = createSchedule()
      const error = new Error('Execution failed')

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)
      mockQueue.enqueue.mockRejectedValue(error)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          scheduleName: 'Test Schedule',
          error: 'Execution failed',
        })
      )

      consoleErrorSpy.mockRestore()
    })

    it('should update lastRunAt and nextRunAt', async () => {
      const schedule = createSchedule()
      const freshSchedule = { ...schedule, lastRunAt: null, nextRunAt: new Date() }

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue(freshSchedule)
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(freshSchedule.lastRunAt).toBeInstanceOf(Date)
      expect(freshSchedule.nextRunAt).toBeInstanceOf(Date)
      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should always release lock', async () => {
      const schedule = createSchedule()
      const error = new Error('Execution failed')

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)
      mockQueue.enqueue.mockRejectedValue(error)

      jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockLockStrategy.unlock).toHaveBeenCalledWith('schedule:test-1')
    })

    it('should check feature flag if required', async () => {
      const schedule = createSchedule({
        requireFeature: 'test.feature',
        scopeType: 'tenant',
        tenantId: 'tenant-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockRbacService.tenantHasFeature.mockResolvedValue(true)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockRbacService.tenantHasFeature).toHaveBeenCalledWith(
        'tenant-1',
        'test.feature',
        expect.objectContaining({
          organizationId: null,
        })
      )
    })

    it('should skip if feature is not available', async () => {
      const schedule = createSchedule({
        requireFeature: 'test.feature',
        scopeType: 'tenant',
        tenantId: 'tenant-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)
      mockRbacService.tenantHasFeature.mockResolvedValue(false)

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.start()

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[scheduler:local] Schedule Test Schedule skipped: missing feature test.feature'
      )
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.skipped',
        expect.objectContaining({
          id: 'test-1',
          reason: 'Missing required feature: test.feature',
        })
      )
      expect(mockQueue.enqueue).not.toHaveBeenCalled()

      consoleLogSpy.mockRestore()
    })

    it('should not check feature for system-scoped schedules', async () => {
      const schedule = createSchedule({
        requireFeature: 'test.feature',
        scopeType: 'system',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockRbacService.tenantHasFeature).not.toHaveBeenCalled()
      expect(mockQueue.enqueue).toHaveBeenCalled()
    })

    it('should update nextRunAt even on failure', async () => {
      const schedule = createSchedule()
      const freshSchedule = { ...schedule, nextRunAt: new Date() }
      const error = new Error('Execution failed')

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue(freshSchedule)
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)
      mockQueue.enqueue.mockRejectedValue(error)

      jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should throw if target queue is missing for queue target', async () => {
      const schedule = createSchedule({
        targetQueue: null,
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          error: 'Target queue is required for queue target type',
        })
      )

      consoleErrorSpy.mockRestore()
    })

    it('should throw if target command is missing for command target', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: null,
        targetQueue: null,
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          error: 'Target command is required for command target type',
        })
      )

      consoleErrorSpy.mockRestore()
    })

    it('should pass payload to queue job', async () => {
      const schedule = createSchedule({
        targetPayload: { foo: 'bar', baz: 123 },
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { foo: 'bar', baz: 123 },
        })
      )
    })

    it('should pass scope to command input', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: 'test:command',
        targetQueue: null,
        targetPayload: { data: 'test' },
        scopeType: 'organization',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.tryLock.mockResolvedValue(true)
      mockLockStrategy.unlock.mockResolvedValue(undefined as any)
      mockCommandBusInstance.execute.mockResolvedValue({ success: true })

      await service.start()

      expect(mockCommandBusInstance.execute).toHaveBeenCalledWith(
        'test:command',
        expect.objectContaining({
          input: expect.objectContaining({
            data: 'test',
            tenantId: 'tenant-1',
            organizationId: 'org-1',
          }),
          ctx: expect.objectContaining({
            selectedOrganizationId: 'org-1',
            organizationIds: ['org-1'],
          }),
        })
      )
    })
  })
})
