import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ScheduledJobSubscriber } from '../scheduledJobSubscriber'
import { ScheduledJob } from '../../data/entities.js'

describe('ScheduledJobSubscriber', () => {
  describe('getSubscribedEntities', () => {
    it('should subscribe to ScheduledJob entity', () => {
      const subscriber = new ScheduledJobSubscriber()
      const entities = subscriber.getSubscribedEntities()

      expect(entities).toEqual([ScheduledJob])
    })
  })

  describe('constructor', () => {
    it('should read QUEUE_STRATEGY from environment', () => {
      const originalStrategy = process.env.QUEUE_STRATEGY

      // Test with async strategy
      process.env.QUEUE_STRATEGY = 'async'
      const subscriber1 = new ScheduledJobSubscriber()
      expect((subscriber1 as any).queueStrategy).toBe('async')

      // Test with local strategy
      process.env.QUEUE_STRATEGY = 'local'
      const subscriber2 = new ScheduledJobSubscriber()
      expect((subscriber2 as any).queueStrategy).toBe('local')

      // Test with default (no env var)
      delete process.env.QUEUE_STRATEGY
      const subscriber3 = new ScheduledJobSubscriber()
      expect((subscriber3 as any).queueStrategy).toBe('local')

      // Restore original
      if (originalStrategy !== undefined) {
        process.env.QUEUE_STRATEGY = originalStrategy
      } else {
        delete process.env.QUEUE_STRATEGY
      }
    })
  })

  describe('afterFlush', () => {
    let subscriber: ScheduledJobSubscriber
    let mockBullMQService: any
    let mockFlushArgs: any

    beforeEach(() => {
      // Set up async strategy for tests
      const originalStrategy = process.env.QUEUE_STRATEGY
      process.env.QUEUE_STRATEGY = 'async'
      
      subscriber = new ScheduledJobSubscriber()

      // Mock BullMQ service
      mockBullMQService = {
        register: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
        unregister: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
      }

      // Attach mock container via typed setter
      subscriber.setContainer({
        hasRegistration: jest.fn().mockReturnValue(true),
        resolve: jest.fn().mockReturnValue(mockBullMQService),
      } as any)

      // Mock flush args
      mockFlushArgs = {
        uow: {
          getChangeSets: jest.fn().mockReturnValue([]),
        },
      }

      // Restore original strategy
      if (originalStrategy !== undefined) {
        process.env.QUEUE_STRATEGY = originalStrategy
      } else {
        delete process.env.QUEUE_STRATEGY
      }
    })

    it('should do nothing when queue strategy is local', async () => {
      const originalStrategy = process.env.QUEUE_STRATEGY
      process.env.QUEUE_STRATEGY = 'local'
      
      const localSubscriber = new ScheduledJobSubscriber()
      await localSubscriber.afterFlush(mockFlushArgs)

      expect(mockFlushArgs.uow.getChangeSets).not.toHaveBeenCalled()

      if (originalStrategy !== undefined) {
        process.env.QUEUE_STRATEGY = originalStrategy
      } else {
        delete process.env.QUEUE_STRATEGY
      }
    })

    it('should register new enabled schedule', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = null

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'create',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).toHaveBeenCalledWith(
        schedule,
        { skipNextRunUpdate: true }
      )
      expect(mockBullMQService.unregister).not.toHaveBeenCalled()
    })

    it('should register updated enabled schedule', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Updated Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = null

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'update',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).toHaveBeenCalledWith(
        schedule,
        { skipNextRunUpdate: true }
      )
      expect(mockBullMQService.unregister).not.toHaveBeenCalled()
    })

    it('should unregister disabled schedule on create', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Disabled Schedule'
      schedule.isEnabled = false

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'create',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule.id)
    })

    it('should unregister disabled schedule on update', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Now Disabled Schedule'
      schedule.isEnabled = false

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'update',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule.id)
    })

    it('should unregister soft-deleted schedule', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Soft Deleted Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = new Date()

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'update',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule.id)
    })

    it('should unregister hard-deleted schedule', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Deleted Schedule'

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'delete',
          entity: schedule,
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule.id)
    })

    it('should process multiple change sets', async () => {
      const schedule1 = new ScheduledJob()
      schedule1.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule1.name = 'Schedule 1'
      schedule1.isEnabled = true

      const schedule2 = new ScheduledJob()
      schedule2.id = '123e4567-e89b-12d3-a456-426614174001'
      schedule2.name = 'Schedule 2'
      schedule2.isEnabled = false

      const schedule3 = new ScheduledJob()
      schedule3.id = '123e4567-e89b-12d3-a456-426614174002'
      schedule3.name = 'Schedule 3'

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule1 },
        { type: 'update', entity: schedule2 },
        { type: 'delete', entity: schedule3 },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).toHaveBeenCalledTimes(1)
      expect(mockBullMQService.register).toHaveBeenCalledWith(
        schedule1,
        { skipNextRunUpdate: true }
      )
      
      expect(mockBullMQService.unregister).toHaveBeenCalledTimes(2)
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule2.id)
      expect(mockBullMQService.unregister).toHaveBeenCalledWith(schedule3.id)
    })

    it('should ignore non-ScheduledJob entities', async () => {
      // Create a fake entity that is not ScheduledJob
      class OtherEntity {
        id = '123'
        name = 'Other'
      }

      const otherEntity = new OtherEntity()

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: otherEntity },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).not.toHaveBeenCalled()
    })

    it('should continue processing on BullMQ error', async () => {
      const schedule1 = new ScheduledJob()
      schedule1.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule1.name = 'Schedule 1'
      schedule1.isEnabled = true

      const schedule2 = new ScheduledJob()
      schedule2.id = '123e4567-e89b-12d3-a456-426614174001'
      schedule2.name = 'Schedule 2'
      schedule2.isEnabled = true

      // First call fails, second succeeds
      mockBullMQService.register
        .mockRejectedValueOnce(new Error('BullMQ connection failed'))
        .mockResolvedValueOnce(undefined)

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule1 },
        { type: 'create', entity: schedule2 },
      ])

      // Should not throw despite error
      await expect(subscriber.afterFlush(mockFlushArgs)).resolves.not.toThrow()

      expect(mockBullMQService.register).toHaveBeenCalledTimes(2)
    })

    it('should handle missing BullMQ service gracefully', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true

      // Mock container without BullMQ service
      subscriber.setContainer({
        hasRegistration: jest.fn().mockReturnValue(false),
      } as any)

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule },
      ])

      // Should not throw when service is missing
      await expect(subscriber.afterFlush(mockFlushArgs)).resolves.not.toThrow()
    })

    it('should handle missing container gracefully', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true

      // Set container to null to simulate missing container
      subscriber.setContainer(null as any)

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule },
      ])

      // Should not throw when container is missing
      await expect(subscriber.afterFlush(mockFlushArgs)).resolves.not.toThrow()
    })

    it('should cache BullMQ service instance', async () => {
      const schedule1 = new ScheduledJob()
      schedule1.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule1.name = 'Schedule 1'
      schedule1.isEnabled = true

      const schedule2 = new ScheduledJob()
      schedule2.id = '123e4567-e89b-12d3-a456-426614174001'
      schedule2.name = 'Schedule 2'
      schedule2.isEnabled = true

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule1 },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'create', entity: schedule2 },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      // Container should only resolve once (service is cached)
      const mockContainer = (subscriber as any).container
      expect(mockContainer.resolve).toHaveBeenCalledTimes(1)
    })

    it('should pass skipNextRunUpdate flag to register', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = null

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        { type: 'update', entity: schedule },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).toHaveBeenCalledWith(
        schedule,
        { skipNextRunUpdate: true }
      )
    })

    it('should skip BullMQ sync when only lastRunAt/nextRunAt changed', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = null

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'update',
          entity: schedule,
          payload: { lastRunAt: new Date(), updatedAt: new Date() },
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).not.toHaveBeenCalled()
      expect(mockBullMQService.unregister).not.toHaveBeenCalled()
    })

    it('should sync when config fields change alongside lastRunAt', async () => {
      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Test Schedule'
      schedule.isEnabled = true
      schedule.deletedAt = null

      mockFlushArgs.uow.getChangeSets.mockReturnValue([
        {
          type: 'update',
          entity: schedule,
          payload: { lastRunAt: new Date(), scheduleValue: '*/5 * * * *' },
        },
      ])

      await subscriber.afterFlush(mockFlushArgs)

      expect(mockBullMQService.register).toHaveBeenCalledWith(
        schedule,
        { skipNextRunUpdate: true }
      )
    })
  })

  describe('integration scenarios', () => {
    it('should handle schedule lifecycle: create -> update -> disable -> delete', async () => {
      const originalStrategy = process.env.QUEUE_STRATEGY
      process.env.QUEUE_STRATEGY = 'async'

      const subscriber = new ScheduledJobSubscriber()

      const mockBullMQService = {
        register: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
        unregister: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
      }

      subscriber.setContainer({
        hasRegistration: jest.fn().mockReturnValue(true),
        resolve: jest.fn().mockReturnValue(mockBullMQService),
      } as any)

      const schedule = new ScheduledJob()
      schedule.id = '123e4567-e89b-12d3-a456-426614174000'
      schedule.name = 'Lifecycle Test'
      schedule.isEnabled = true

      // Create
      await subscriber.afterFlush({
        uow: {
          getChangeSets: () => [{ type: 'create', entity: schedule }],
        },
      } as any)

      expect(mockBullMQService.register).toHaveBeenCalledTimes(1)
      expect(mockBullMQService.unregister).toHaveBeenCalledTimes(0)

      // Update (still enabled)
      schedule.name = 'Updated Name'
      await subscriber.afterFlush({
        uow: {
          getChangeSets: () => [{ type: 'update', entity: schedule }],
        },
      } as any)

      expect(mockBullMQService.register).toHaveBeenCalledTimes(2)
      expect(mockBullMQService.unregister).toHaveBeenCalledTimes(0)

      // Disable
      schedule.isEnabled = false
      await subscriber.afterFlush({
        uow: {
          getChangeSets: () => [{ type: 'update', entity: schedule }],
        },
      } as any)

      expect(mockBullMQService.register).toHaveBeenCalledTimes(2)
      expect(mockBullMQService.unregister).toHaveBeenCalledTimes(1)

      // Delete
      await subscriber.afterFlush({
        uow: {
          getChangeSets: () => [{ type: 'delete', entity: schedule }],
        },
      } as any)

      expect(mockBullMQService.register).toHaveBeenCalledTimes(2)
      expect(mockBullMQService.unregister).toHaveBeenCalledTimes(2)

      if (originalStrategy !== undefined) {
        process.env.QUEUE_STRATEGY = originalStrategy
      } else {
        delete process.env.QUEUE_STRATEGY
      }
    })
  })
})
