import { SchedulerService, type ScheduleRegistration } from '../schedulerService'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../../data/entities.js'
import type { BullMQSchedulerService } from '../bullmqSchedulerService'

describe('SchedulerService', () => {
  let service: SchedulerService
  let mockEm: jest.Mocked<EntityManager>
  let mockBullMQService: jest.Mocked<BullMQSchedulerService>
  let mockForkedEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    // Create mock forked EM
    mockForkedEm = {
      findOne: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(),
      remove: jest.fn(),
      flush: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
    } as any

    // Create mock main EM
    mockEm = {
      fork: jest.fn(() => mockForkedEm),
      count: jest.fn(),
      find: jest.fn(),
    } as any

    // Create mock BullMQ service
    mockBullMQService = {
      register: jest.fn(),
      unregister: jest.fn(),
    } as any

    // Create service
    service = new SchedulerService(
      () => mockEm,
      mockBullMQService,
    )
  })

  describe('register', () => {
    const baseRegistration: ScheduleRegistration = {
      id: 'test-schedule-1',
      name: 'Test Schedule',
      scopeType: 'system',
      scheduleType: 'cron',
      scheduleValue: '0 0 * * *',
      targetType: 'queue',
      targetQueue: 'test-queue',
    }

    it('should create a new schedule when it does not exist', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await service.register(baseRegistration)

      expect(mockEm.fork).toHaveBeenCalled()
      expect(mockForkedEm.findOne).toHaveBeenCalledWith(ScheduledJob, { id: 'test-schedule-1' })
      expect(mockForkedEm.create).toHaveBeenCalledWith(ScheduledJob, expect.objectContaining({
        id: 'test-schedule-1',
        name: 'Test Schedule',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test-queue',
        isEnabled: true,
      }))
      expect(mockForkedEm.persist).toHaveBeenCalled()
      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should update an existing schedule', async () => {
      const existingSchedule = {
        id: 'test-schedule-1',
        name: 'Old Name',
        isEnabled: true,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(existingSchedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.register({
        ...baseRegistration,
        name: 'Updated Name',
      })

      expect(existingSchedule.name).toBe('Updated Name')
      expect(mockForkedEm.flush).toHaveBeenCalled()
      expect(mockForkedEm.create).not.toHaveBeenCalled()
    })

    it('should sync with BullMQ if enabled', async () => {
      const schedule = { id: 'test-1', isEnabled: true } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.create.mockReturnValue(schedule)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.register.mockResolvedValue()

      await service.register(baseRegistration)

      expect(mockBullMQService.register).toHaveBeenCalledWith(schedule)
    })

    it('should unregister from BullMQ if schedule is disabled', async () => {
      const schedule = { id: 'test-schedule-1', isEnabled: false } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.create.mockReturnValue(schedule)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.unregister.mockResolvedValue()

      await service.register({
        ...baseRegistration,
        isEnabled: false,
      })

      expect(mockBullMQService.unregister).toHaveBeenCalledWith('test-schedule-1')
    })

    it('should not throw if BullMQ sync fails', async () => {
      const schedule = { id: 'test-1', isEnabled: true } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.create.mockReturnValue(schedule)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.register.mockRejectedValue(new Error('BullMQ error'))

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await expect(service.register(baseRegistration)).resolves.not.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[scheduler] Failed to sync with BullMQ:',
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })

    it('should throw if next run calculation fails', async () => {
      await expect(service.register({
        ...baseRegistration,
        scheduleValue: '', // Invalid cron
      })).rejects.toThrow('Failed to calculate next run time')
    })

    it('should default timezone to UTC', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await service.register(baseRegistration)

      expect(mockForkedEm.create).toHaveBeenCalledWith(ScheduledJob, expect.objectContaining({
        timezone: 'UTC',
      }))
    })

    it('should use provided timezone', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await service.register({
        ...baseRegistration,
        timezone: 'America/New_York',
      })

      expect(mockForkedEm.create).toHaveBeenCalledWith(ScheduledJob, expect.objectContaining({
        timezone: 'America/New_York',
      }))
    })
  })

  describe('unregister', () => {
    it('should remove schedule from database', async () => {
      const schedule = { id: 'test-1' } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.remove.mockReturnValue(mockForkedEm as any)
      mockForkedEm.flush.mockResolvedValue()

      await service.unregister('test-1')

      expect(mockForkedEm.findOne).toHaveBeenCalledWith(ScheduledJob, { id: 'test-1' })
      expect(mockForkedEm.remove).toHaveBeenCalledWith(schedule)
      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should unregister from BullMQ', async () => {
      const schedule = { id: 'test-1' } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.remove.mockReturnValue(mockForkedEm as any)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.unregister.mockResolvedValue()

      await service.unregister('test-1')

      expect(mockBullMQService.unregister).toHaveBeenCalledWith('test-1')
    })

    it('should not throw if BullMQ unregister fails', async () => {
      const schedule = { id: 'test-1' } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.remove.mockReturnValue(mockForkedEm as any)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.unregister.mockRejectedValue(new Error('BullMQ error'))

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      await expect(service.unregister('test-1')).resolves.not.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('should do nothing if schedule does not exist', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)

      await service.unregister('non-existent')

      expect(mockForkedEm.remove).not.toHaveBeenCalled()
      expect(mockForkedEm.flush).not.toHaveBeenCalled()
    })
  })

  describe('exists', () => {
    it('should return true if schedule exists', async () => {
      mockEm.count.mockResolvedValue(1)

      const result = await service.exists('test-1')

      expect(result).toBe(true)
      expect(mockEm.count).toHaveBeenCalledWith(ScheduledJob, { id: 'test-1' })
    })

    it('should return false if schedule does not exist', async () => {
      mockEm.count.mockResolvedValue(0)

      const result = await service.exists('test-1')

      expect(result).toBe(false)
    })
  })

  describe('update', () => {
    it('should update schedule fields', async () => {
      const schedule = {
        id: 'test-1',
        name: 'Old Name',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        isEnabled: true,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.update('test-1', {
        name: 'New Name',
        description: 'New Description',
      })

      expect(schedule.name).toBe('New Name')
      expect(schedule.description).toBe('New Description')
      expect(mockForkedEm.flush).toHaveBeenCalled()
    })

    it('should throw if schedule not found', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)

      await expect(service.update('non-existent', { name: 'New Name' }))
        .rejects.toThrow('Schedule not found: non-existent')
    })

    it('should recalculate next run if schedule changed', async () => {
      const schedule = {
        id: 'test-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        nextRunAt: new Date('2025-01-01'),
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.update('test-1', {
        scheduleValue: '0 12 * * *', // Change to noon
      })

      expect(schedule.scheduleValue).toBe('0 12 * * *')
      expect(schedule.nextRunAt).not.toEqual(new Date('2025-01-01'))
    })

    it('should clear targetCommand when switching to queue', async () => {
      const schedule = {
        id: 'test-1',
        targetType: 'command',
        targetCommand: 'old-command',
        targetQueue: null,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.update('test-1', {
        targetType: 'queue',
        targetQueue: 'new-queue',
      })

      expect(schedule.targetType).toBe('queue')
      expect(schedule.targetQueue).toBe('new-queue')
      expect(schedule.targetCommand).toBeNull()
    })

    it('should clear targetQueue when switching to command', async () => {
      const schedule = {
        id: 'test-1',
        targetType: 'queue',
        targetQueue: 'old-queue',
        targetCommand: null,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.update('test-1', {
        targetType: 'command',
        targetCommand: 'new-command',
      })

      expect(schedule.targetType).toBe('command')
      expect(schedule.targetCommand).toBe('new-command')
      expect(schedule.targetQueue).toBeNull()
    })

    it('should sync with BullMQ after update', async () => {
      const schedule = {
        id: 'test-1',
        isEnabled: true,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.register.mockResolvedValue()

      await service.update('test-1', { name: 'Updated' })

      expect(mockBullMQService.register).toHaveBeenCalledWith(schedule)
    })

    it('should unregister from BullMQ if disabled', async () => {
      const schedule = {
        id: 'test-1',
        isEnabled: false,
      } as ScheduledJob

      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()
      mockBullMQService.unregister.mockResolvedValue()

      await service.update('test-1', { isEnabled: false })

      expect(mockBullMQService.unregister).toHaveBeenCalledWith('test-1')
    })
  })

  describe('findByModule', () => {
    it('should find schedules by module', async () => {
      const schedules = [
        { id: '1', sourceModule: 'test-module' },
        { id: '2', sourceModule: 'test-module' },
      ] as ScheduledJob[]

      mockEm.find.mockResolvedValue(schedules)

      const result = await service.findByModule('test-module')

      expect(result).toEqual(schedules)
      expect(mockEm.find).toHaveBeenCalledWith(ScheduledJob, {
        sourceModule: 'test-module',
        deletedAt: null,
      }, { limit: 100 })
    })

    it('should return empty array if no schedules found', async () => {
      mockEm.find.mockResolvedValue([])

      const result = await service.findByModule('non-existent')

      expect(result).toEqual([])
    })
  })

  describe('enable', () => {
    it('should enable a schedule', async () => {
      const schedule = { id: 'test-1', isEnabled: false } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.enable('test-1')

      expect(schedule.isEnabled).toBe(true)
    })
  })

  describe('disable', () => {
    it('should disable a schedule', async () => {
      const schedule = { id: 'test-1', isEnabled: true } as ScheduledJob
      mockForkedEm.findOne.mockResolvedValue(schedule)
      mockForkedEm.flush.mockResolvedValue()

      await service.disable('test-1')

      expect(schedule.isEnabled).toBe(false)
    })
  })

  describe('validateScope', () => {
    it('should accept system scope without org/tenant', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).resolves.not.toThrow()
    })

    it('should reject system scope with organizationId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        organizationId: 'org-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('System-scoped schedules cannot have organizationId or tenantId')
    })

    it('should reject system scope with tenantId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        tenantId: 'tenant-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('System-scoped schedules cannot have organizationId or tenantId')
    })

    it('should accept organization scope with both org and tenant', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'organization',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).resolves.not.toThrow()
    })

    it('should reject organization scope without organizationId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'organization',
        tenantId: 'tenant-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('Organization-scoped schedules must have both organizationId and tenantId')
    })

    it('should reject organization scope without tenantId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'organization',
        organizationId: 'org-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('Organization-scoped schedules must have both organizationId and tenantId')
    })

    it('should accept tenant scope with tenantId only', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'tenant',
        tenantId: 'tenant-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).resolves.not.toThrow()
    })

    it('should reject tenant scope with organizationId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'tenant',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('Tenant-scoped schedules must have tenantId and no organizationId')
    })

    it('should reject tenant scope without tenantId', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'tenant',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })).rejects.toThrow('Tenant-scoped schedules must have tenantId and no organizationId')
    })
  })

  describe('validateTarget', () => {
    it('should accept queue target with targetQueue', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test-queue',
      })).resolves.not.toThrow()
    })

    it('should reject queue target without targetQueue', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
      } as any)).rejects.toThrow('Queue target must have targetQueue')
    })

    it('should accept command target with targetCommand', async () => {
      mockForkedEm.findOne.mockResolvedValue(null)
      mockForkedEm.flush.mockResolvedValue()

      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'command',
        targetCommand: 'test:command',
      })).resolves.not.toThrow()
    })

    it('should reject command target without targetCommand', async () => {
      await expect(service.register({
        id: 'test-1',
        name: 'Test',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'command',
      } as any)).rejects.toThrow('Command target must have targetCommand')
    })
  })
})
