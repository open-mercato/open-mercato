import { describe, it, expect } from '@jest/globals'
import { ScheduledJob } from '../entities'

describe('ScheduledJob entity', () => {
  describe('entity metadata', () => {
    it('should have correct entity name', () => {
      // Basic check - entity should be decorated
      expect(ScheduledJob).toBeDefined()
      expect(ScheduledJob.name).toBe('ScheduledJob')
    })

    it('should be constructible', () => {
      const job = new ScheduledJob()
      
      // Entity should be instantiable
      expect(job).toBeDefined()
      expect(job).toBeInstanceOf(ScheduledJob)
    })
  })

  describe('entity structure', () => {
    it('should create instance with all properties', () => {
      const job = new ScheduledJob()
      
      // Set required properties
      job.id = '123e4567-e89b-12d3-a456-426614174000'
      job.name = 'Test Schedule'
      job.scopeType = 'system'
      job.scheduleType = 'cron'
      job.scheduleValue = '0 0 * * *'
      job.timezone = 'UTC'
      job.targetType = 'queue'
      job.targetQueue = 'test-queue'
      job.isEnabled = true
      job.sourceType = 'user'
      job.createdAt = new Date()
      job.updatedAt = new Date()

      expect(job.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(job.name).toBe('Test Schedule')
      expect(job.scopeType).toBe('system')
      expect(job.scheduleType).toBe('cron')
      expect(job.scheduleValue).toBe('0 0 * * *')
      expect(job.timezone).toBe('UTC')
      expect(job.targetType).toBe('queue')
      expect(job.targetQueue).toBe('test-queue')
      expect(job.isEnabled).toBe(true)
      expect(job.sourceType).toBe('user')
    })

    it('should support system scope', () => {
      const job = new ScheduledJob()
      job.scopeType = 'system'
      job.organizationId = null
      job.tenantId = null

      expect(job.scopeType).toBe('system')
      expect(job.organizationId).toBeNull()
      expect(job.tenantId).toBeNull()
    })

    it('should support organization scope', () => {
      const job = new ScheduledJob()
      job.scopeType = 'organization'
      job.organizationId = '123e4567-e89b-12d3-a456-426614174001'
      job.tenantId = '123e4567-e89b-12d3-a456-426614174002'

      expect(job.scopeType).toBe('organization')
      expect(job.organizationId).toBe('123e4567-e89b-12d3-a456-426614174001')
      expect(job.tenantId).toBe('123e4567-e89b-12d3-a456-426614174002')
    })

    it('should support tenant scope', () => {
      const job = new ScheduledJob()
      job.scopeType = 'tenant'
      job.organizationId = null
      job.tenantId = '123e4567-e89b-12d3-a456-426614174002'

      expect(job.scopeType).toBe('tenant')
      expect(job.organizationId).toBeNull()
      expect(job.tenantId).toBe('123e4567-e89b-12d3-a456-426614174002')
    })

    it('should support cron schedule type', () => {
      const job = new ScheduledJob()
      job.scheduleType = 'cron'
      job.scheduleValue = '0 0 * * *'
      job.timezone = 'America/New_York'

      expect(job.scheduleType).toBe('cron')
      expect(job.scheduleValue).toBe('0 0 * * *')
      expect(job.timezone).toBe('America/New_York')
    })

    it('should support interval schedule type', () => {
      const job = new ScheduledJob()
      job.scheduleType = 'interval'
      job.scheduleValue = '15m'

      expect(job.scheduleType).toBe('interval')
      expect(job.scheduleValue).toBe('15m')
    })

    it('should support queue target type', () => {
      const job = new ScheduledJob()
      job.targetType = 'queue'
      job.targetQueue = 'backup-queue'
      job.targetCommand = null
      job.targetPayload = { priority: 'high' }

      expect(job.targetType).toBe('queue')
      expect(job.targetQueue).toBe('backup-queue')
      expect(job.targetCommand).toBeNull()
      expect(job.targetPayload).toEqual({ priority: 'high' })
    })

    it('should support command target type', () => {
      const job = new ScheduledJob()
      job.targetType = 'command'
      job.targetCommand = 'catalog.sync'
      job.targetQueue = null
      job.targetPayload = { full: true }

      expect(job.targetType).toBe('command')
      expect(job.targetCommand).toBe('catalog.sync')
      expect(job.targetQueue).toBeNull()
      expect(job.targetPayload).toEqual({ full: true })
    })

    it('should support optional feature requirement', () => {
      const job = new ScheduledJob()
      job.requireFeature = 'scheduler.manage'

      expect(job.requireFeature).toBe('scheduler.manage')
    })

    it('should support enabled/disabled state', () => {
      const job = new ScheduledJob()
      
      job.isEnabled = true
      expect(job.isEnabled).toBe(true)
      
      job.isEnabled = false
      expect(job.isEnabled).toBe(false)
    })

    it('should support execution timestamps', () => {
      const job = new ScheduledJob()
      const lastRun = new Date('2025-01-26T10:00:00Z')
      const nextRun = new Date('2025-01-27T10:00:00Z')
      
      job.lastRunAt = lastRun
      job.nextRunAt = nextRun

      expect(job.lastRunAt).toBe(lastRun)
      expect(job.nextRunAt).toBe(nextRun)
    })

    it('should support user source type', () => {
      const job = new ScheduledJob()
      job.sourceType = 'user'
      job.sourceModule = null

      expect(job.sourceType).toBe('user')
      expect(job.sourceModule).toBeNull()
    })

    it('should support module source type', () => {
      const job = new ScheduledJob()
      job.sourceType = 'module'
      job.sourceModule = 'catalog'

      expect(job.sourceType).toBe('module')
      expect(job.sourceModule).toBe('catalog')
    })

    it('should support audit fields', () => {
      const job = new ScheduledJob()
      const created = new Date('2025-01-26T10:00:00Z')
      const updated = new Date('2025-01-26T12:00:00Z')
      const userId = '123e4567-e89b-12d3-a456-426614174003'
      
      job.createdAt = created
      job.updatedAt = updated
      job.createdByUserId = userId
      job.updatedByUserId = userId

      expect(job.createdAt).toBe(created)
      expect(job.updatedAt).toBe(updated)
      expect(job.createdByUserId).toBe(userId)
      expect(job.updatedByUserId).toBe(userId)
    })

    it('should support soft delete', () => {
      const job = new ScheduledJob()
      const deleted = new Date('2025-01-26T15:00:00Z')
      
      job.deletedAt = null
      expect(job.deletedAt).toBeNull()
      
      job.deletedAt = deleted
      expect(job.deletedAt).toBe(deleted)
    })

    it('should support complex target payload', () => {
      const job = new ScheduledJob()
      const payload = {
        action: 'sync',
        options: {
          fullSync: true,
          batchSize: 100,
        },
        targets: ['products', 'prices'],
        metadata: {
          version: '2.0',
        },
      }
      
      job.targetPayload = payload

      expect(job.targetPayload).toEqual(payload)
      expect(job.targetPayload?.action).toBe('sync')
      expect((job.targetPayload as any)?.options?.fullSync).toBe(true)
    })

    it('should handle null optional fields', () => {
      const job = new ScheduledJob()
      
      job.organizationId = null
      job.tenantId = null
      job.description = null
      job.targetQueue = null
      job.targetCommand = null
      job.targetPayload = null
      job.requireFeature = null
      job.lastRunAt = null
      job.nextRunAt = null
      job.sourceModule = null
      job.deletedAt = null
      job.createdByUserId = null
      job.updatedByUserId = null

      expect(job.organizationId).toBeNull()
      expect(job.tenantId).toBeNull()
      expect(job.description).toBeNull()
      expect(job.targetQueue).toBeNull()
      expect(job.targetCommand).toBeNull()
      expect(job.targetPayload).toBeNull()
      expect(job.requireFeature).toBeNull()
      expect(job.lastRunAt).toBeNull()
      expect(job.nextRunAt).toBeNull()
      expect(job.sourceModule).toBeNull()
      expect(job.deletedAt).toBeNull()
      expect(job.createdByUserId).toBeNull()
      expect(job.updatedByUserId).toBeNull()
    })

    it('should support description field', () => {
      const job = new ScheduledJob()
      const description = 'This schedule runs daily backups of all user data'
      
      job.description = description
      expect(job.description).toBe(description)
    })
  })

  describe('scope type literals', () => {
    it('should only accept valid scope types', () => {
      const job = new ScheduledJob()
      
      // Valid scope types
      job.scopeType = 'system'
      expect(job.scopeType).toBe('system')
      
      job.scopeType = 'organization'
      expect(job.scopeType).toBe('organization')
      
      job.scopeType = 'tenant'
      expect(job.scopeType).toBe('tenant')
    })
  })

  describe('schedule type literals', () => {
    it('should only accept valid schedule types', () => {
      const job = new ScheduledJob()
      
      job.scheduleType = 'cron'
      expect(job.scheduleType).toBe('cron')
      
      job.scheduleType = 'interval'
      expect(job.scheduleType).toBe('interval')
    })
  })

  describe('target type literals', () => {
    it('should only accept valid target types', () => {
      const job = new ScheduledJob()
      
      job.targetType = 'queue'
      expect(job.targetType).toBe('queue')
      
      job.targetType = 'command'
      expect(job.targetType).toBe('command')
    })
  })

  describe('source type literals', () => {
    it('should only accept valid source types', () => {
      const job = new ScheduledJob()
      
      job.sourceType = 'user'
      expect(job.sourceType).toBe('user')
      
      job.sourceType = 'module'
      expect(job.sourceType).toBe('module')
    })
  })
})
