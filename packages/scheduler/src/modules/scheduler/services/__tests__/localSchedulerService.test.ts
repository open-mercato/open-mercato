import { LocalSchedulerService } from '../localSchedulerService'
import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import { ScheduledJob } from '../../data/entities.js'
import {
  clearSchedulerSafeCommandsForTests,
  registerSchedulerSafeCommands,
} from '../../lib/scheduler-safe-commands'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
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
const loggerWarn = mockedLogger.warn as jest.Mock
const loggerError = mockedLogger.error as jest.Mock

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
    runWithLock: jest.fn(),
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
  let mockRbacService: { tenantHasFeature: jest.Mock; userHasAllFeatures: jest.Mock }
  let mockLockStrategy: { runWithLock: jest.Mock }

  beforeAll(() => {
    // Queue-target dispatch reauthorizes against scheduler-safe queues (#5213);
    // seed one safe queue and one module-owned internal queue for the guards.
    registerModules([
      {
        id: 'test_module',
        workers: [
          {
            id: 'test_module:workers:test-queue',
            queue: 'test-queue',
            concurrency: 1,
            schedulerSafe: true,
            handler: async () => {},
          },
        ],
      },
      {
        id: 'legacy_module',
        workers: [
          {
            id: 'legacy_module:workers:internal',
            queue: 'legacy-internal',
            concurrency: 1,
            handler: async () => {},
          },
        ],
      },
    ] as never)
  })

  afterAll(() => {
    ;(globalThis as Record<string, unknown>).__openMercatoModulesRegistry__ = null
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    clearSchedulerSafeCommandsForTests()
    registerSchedulerSafeCommands([
      {
        commandId: 'test:command',
        requiredFeatures: ['scheduler.jobs.manage'],
      },
    ])

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
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
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

      await service.start()

      expect(loggerInfo).toHaveBeenCalledWith('Starting polling engine', { pollIntervalMs: 1000 })
      expect(loggerInfo).toHaveBeenCalledWith('Polling engine started')
    })

    it('should warn that the local strategy has no cross-process protection', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('no cross-process protection'),
      )
    })

    it('should run initial poll immediately', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()

      expect(mockForkedEm.find).toHaveBeenCalledWith(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
        nextRunAt: { $lte: expect.any(Date) },
      }, {
        limit: 100,
        orderBy: { nextRunAt: 'ASC' },
      })
    })

    it('should not start if already running', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()
      await service.start()

      expect(loggerWarn).toHaveBeenCalledWith('Polling engine already running')
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

      await service.start()
      await service.stop()

      expect(loggerInfo).toHaveBeenCalledWith('Stopping polling engine')
      expect(loggerInfo).toHaveBeenCalledWith('Polling engine stopped')
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
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(loggerInfo).toHaveBeenCalledWith('Found due schedules', { count: 1 })
    })

    it('should log when no schedules are due', async () => {
      mockForkedEm.find.mockResolvedValue([])

      await service.start()

      expect(loggerDebug).toHaveBeenCalledWith('No due schedules')
    })

    it('should handle poll errors gracefully', async () => {
      const error = new Error('Database error')
      mockForkedEm.find.mockRejectedValue(error)

      await service.start()

      expect(loggerError).toHaveBeenCalledWith('Poll failed', { err: error })
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
      mockLockStrategy.runWithLock.mockResolvedValue({ acquired: false })

      await service.start()

      expect(loggerDebug).toHaveBeenCalledWith('Schedule already locked, skipping')
      expect(mockEmitSchedulerEvent).not.toHaveBeenCalled()
    })

    it('should execute queue target', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: null,
          organizationId: null,
          _idempotencyKey: expect.stringMatching(/^scheduler-test-1-/),
          _jobOrigin: 'scheduler',
        })
      )
    })

    it('should sanitize author-supplied scope and envelope keys from the target payload', async () => {
      const schedule = createSchedule({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        sourceType: 'module',
        sourceModule: 'test_module',
        targetQueue: 'test-queue',
        targetPayload: {
          scope: { tenantId: 'forged-tenant', organizationId: 'forged-org' },
          tenantId: 'forged-tenant',
          _jobOrigin: 'inbound-webhook',
          payload: { nested: 'data', _idempotencyKey: 'forged' },
          legit: 'kept',
        },
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          payload: { nested: 'data' },
          legit: 'kept',
          scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
          _jobOrigin: 'scheduler',
        })
      )
      const enqueued = mockQueue.enqueue.mock.calls[0][0] as Record<string, unknown>
      expect(enqueued.payload).toEqual({ nested: 'data' })
    })

    it('should refuse user-authored schedules targeting non-safe internal queues', async () => {
      const schedule = createSchedule({
        targetQueue: 'stripe-webhook',
        sourceType: 'user',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })

      await service.start()

      expect(mockQueueFactory).not.toHaveBeenCalled()
      expect(loggerError).toHaveBeenCalled()
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          error: expect.stringContaining('not an approved scheduler target'),
        })
      )
    })

    it('should refuse a pre-upgrade module row whose sourceModule MATCHES the owner but carries an actor stamp (#5213 B1)', async () => {
      // forged pre-upgrade row: attacker set sourceType/sourceModule to the real
      // owning module, but API writes always stamp createdByUserId — which
      // schedulerService.register() never does. The row must fail closed.
      const schedule = createSchedule({
        targetQueue: 'legacy-internal',
        sourceType: 'module',
        sourceModule: 'legacy_module',
        createdByUserId: 'attacker-user',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })

      await service.start()

      expect(mockQueueFactory).not.toHaveBeenCalled()
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          error: expect.stringContaining('not an approved scheduler target'),
        })
      )
    })

    it('should refuse a pre-upgrade module row whose sourceModule does not own its internal queue (#5213 B1)', async () => {
      const schedule = createSchedule({
        targetQueue: 'stripe-webhook',
        sourceType: 'module',
        sourceModule: 'legacy_module',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })

      await service.start()

      expect(mockQueueFactory).not.toHaveBeenCalled()
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          error: expect.stringContaining('not an approved scheduler target'),
        })
      )
    })

    it('should allow module-authored schedules to keep targeting queues their own module owns (#5213 B1)', async () => {
      const schedule = createSchedule({
        targetQueue: 'legacy-internal',
        sourceType: 'module',
        sourceModule: 'legacy_module',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalled()
    })

    it('should execute command target', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: 'test:command',
        targetQueue: null,
        createdByUserId: 'user-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockCommandBusInstance.execute.mockResolvedValue({ success: true })

      await service.start()

      expect(mockCommandBusInstance.execute).toHaveBeenCalledWith(
        'test:command',
        expect.objectContaining({
          input: expect.objectContaining({
            tenantId: null,
            organizationId: null,
          }),
          ctx: expect.objectContaining({
            auth: expect.objectContaining({
              sub: 'user-1',
              userId: 'user-1',
              tenantId: null,
              orgId: null,
            }),
          }),
        })
      )
      expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        'user-1',
        ['scheduler.jobs.manage'],
        { tenantId: null, organizationId: null }
      )
    })

    it('should reject command target that is not scheduler safe', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: 'unsafe.command',
        targetQueue: null,
        createdByUserId: 'user-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockCommandBusInstance.execute).not.toHaveBeenCalled()
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          error: 'Scheduled command is not allowed',
        })
      )
      consoleErrorSpy.mockRestore()
    })

    it('should reject command target when the schedule creator lacks required features', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: 'test:command',
        targetQueue: null,
        createdByUserId: 'user-1',
      })

      mockRbacService.userHasAllFeatures.mockResolvedValueOnce(false)
      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await service.start()

      expect(mockCommandBusInstance.execute).not.toHaveBeenCalled()
      expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        'user-1',
        ['scheduler.jobs.manage'],
        { tenantId: null, organizationId: null }
      )
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          error: 'Scheduled command actor is not authorized',
        })
      )
      consoleErrorSpy.mockRestore()
    })

    it('should emit started event', async () => {
      const schedule = createSchedule()

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
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
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
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
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockRejectedValue(error)

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          id: 'test-1',
          scheduleName: 'Test Schedule',
          error: 'Execution failed',
        })
      )
    })

    it('should update lastRunAt and nextRunAt', async () => {
      const schedule = createSchedule()
      const freshSchedule = { ...schedule, lastRunAt: null, nextRunAt: new Date() }

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue(freshSchedule)
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(freshSchedule.lastRunAt).toBeInstanceOf(Date)
      expect(freshSchedule.nextRunAt).toBeInstanceOf(Date)
      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should execute inside lock wrapper', async () => {
      const schedule = createSchedule()
      const error = new Error('Execution failed')

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockRejectedValue(error)

      await service.start()

      expect(mockLockStrategy.runWithLock).toHaveBeenCalledWith('schedule:test-1', expect.any(Function))
    })

    it('should check feature flag if required', async () => {
      const schedule = createSchedule({
        requireFeature: 'test.feature',
        scopeType: 'tenant',
        tenantId: 'tenant-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
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
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockRbacService.tenantHasFeature.mockResolvedValue(false)

      await service.start()

      expect(loggerInfo).toHaveBeenCalledWith('Schedule skipped: missing required feature', { requireFeature: 'test.feature' })
      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.skipped',
        expect.objectContaining({
          id: 'test-1',
          reason: 'Missing required feature: test.feature',
        })
      )
      expect(mockQueue.enqueue).not.toHaveBeenCalled()
    })

    it('should not check feature for system-scoped schedules', async () => {
      const schedule = createSchedule({
        requireFeature: 'test.feature',
        scopeType: 'system',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
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
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockRejectedValue(error)

      await service.start()

      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should throw if target queue is missing for queue target', async () => {
      const schedule = createSchedule({
        targetQueue: null,
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          error: 'Target queue is required for queue target type',
        })
      )
    })

    it('should throw if target command is missing for command target', async () => {
      const schedule = createSchedule({
        targetType: 'command',
        targetCommand: null,
        targetQueue: null,
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })

      await service.start()

      expect(mockEmitSchedulerEvent).toHaveBeenCalledWith(
        'scheduler.job.failed',
        expect.objectContaining({
          error: 'Target command is required for command target type',
        })
      )
    })

    it('should deliver the flat targetPayload contract to the queue job', async () => {
      const schedule = createSchedule({
        targetPayload: { foo: 'bar', baz: 123, tenantId: 'spoofed-tenant' },
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
      mockQueue.enqueue.mockResolvedValue(undefined as any)

      await service.start()

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          foo: 'bar',
          baz: 123,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          _idempotencyKey: expect.stringMatching(new RegExp(`^scheduler-${schedule.id}-`)),
          _jobOrigin: 'scheduler',
        })
      )
      const enqueued = mockQueue.enqueue.mock.calls[0][0] as Record<string, unknown>
      expect(enqueued).not.toHaveProperty('payload')
      expect(enqueued).not.toHaveProperty('scheduleId')
      expect(enqueued).not.toHaveProperty('scheduleName')
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
        createdByUserId: 'user-1',
      })

      mockForkedEm.find.mockResolvedValue([schedule])
      mockForkedEm.findOne.mockResolvedValue({ ...schedule })
      mockLockStrategy.runWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => {
        await fn()
        return { acquired: true }
      })
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
            auth: expect.objectContaining({
              sub: 'user-1',
              tenantId: 'tenant-1',
              orgId: 'org-1',
            }),
            selectedOrganizationId: 'org-1',
            organizationIds: ['org-1'],
          }),
        })
      )
    })
  })
})
