import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { calculateNextRun } from './nextRunCalculator.js'

export interface ScheduleRegistration {
  id: string
  name: string
  scopeType: 'system' | 'organization' | 'tenant'
  organizationId?: string
  tenantId?: string
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone?: string
  targetType: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: unknown
  requireFeature?: string
  sourceType?: 'user' | 'module'
  sourceModule?: string
  isEnabled?: boolean
  description?: string
}

export class SchedulerService {
  constructor(private em: () => EntityManager) {}

  /**
   * Register a new schedule (upsert)
   */
  async register(registration: ScheduleRegistration): Promise<void> {
    const em = this.em().fork()
    
    // Validate scope consistency
    this.validateScope(registration)
    
    // Validate target consistency
    this.validateTarget(registration)
    
    // Calculate next run time
    const nextRunAt = calculateNextRun(
      registration.scheduleType,
      registration.scheduleValue,
      registration.timezone || 'UTC'
    )
    
    if (!nextRunAt) {
      throw new Error(`Failed to calculate next run time for schedule: ${registration.id}`)
    }
    
    // Check if schedule already exists
    let schedule = await em.findOne(ScheduledJob, { id: registration.id })
    
    if (schedule) {
      // Update existing
      schedule.name = registration.name
      schedule.description = registration.description || null
      schedule.scopeType = registration.scopeType
      schedule.organizationId = registration.organizationId || null
      schedule.tenantId = registration.tenantId || null
      schedule.scheduleType = registration.scheduleType
      schedule.scheduleValue = registration.scheduleValue
      schedule.timezone = registration.timezone || 'UTC'
      schedule.targetType = registration.targetType
      schedule.targetQueue = registration.targetQueue || null
      schedule.targetCommand = registration.targetCommand || null
      schedule.targetPayload = registration.targetPayload as Record<string, unknown> || null
      schedule.requireFeature = registration.requireFeature || null
      schedule.sourceType = registration.sourceType || 'user'
      schedule.sourceModule = registration.sourceModule || null
      schedule.isEnabled = registration.isEnabled !== undefined ? registration.isEnabled : schedule.isEnabled
      schedule.nextRunAt = nextRunAt
      schedule.updatedAt = new Date()
    } else {
      // Create new
      schedule = em.create(ScheduledJob, {
        id: registration.id,
        name: registration.name,
        description: registration.description || null,
        scopeType: registration.scopeType,
        organizationId: registration.organizationId || null,
        tenantId: registration.tenantId || null,
        scheduleType: registration.scheduleType,
        scheduleValue: registration.scheduleValue,
        timezone: registration.timezone || 'UTC',
        targetType: registration.targetType,
        targetQueue: registration.targetQueue || null,
        targetCommand: registration.targetCommand || null,
        targetPayload: registration.targetPayload as Record<string, unknown> || null,
        requireFeature: registration.requireFeature || null,
        sourceType: registration.sourceType || 'module',
        sourceModule: registration.sourceModule || null,
        isEnabled: registration.isEnabled !== undefined ? registration.isEnabled : true,
        nextRunAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(schedule)
    }
    
    await em.flush()
  }

  /**
   * Unregister a schedule
   */
  async unregister(scheduleId: string): Promise<void> {
    const em = this.em().fork()
    const schedule = await em.findOne(ScheduledJob, { id: scheduleId })
    
    if (schedule) {
      await em.remove(schedule).flush()
    }
  }

  /**
   * Check if a schedule exists
   */
  async exists(scheduleId: string): Promise<boolean> {
    const em = this.em()
    const count = await em.count(ScheduledJob, { id: scheduleId })
    return count > 0
  }

  /**
   * Update an existing schedule
   */
  async update(
    scheduleId: string,
    changes: Partial<Omit<ScheduleRegistration, 'id'>>
  ): Promise<void> {
    const em = this.em().fork()
    const schedule = await em.findOne(ScheduledJob, { id: scheduleId })
    
    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`)
    }
    
    // Apply changes
    if (changes.name !== undefined) schedule.name = changes.name
    if (changes.description !== undefined) schedule.description = changes.description || null
    if (changes.scheduleType !== undefined) schedule.scheduleType = changes.scheduleType
    if (changes.scheduleValue !== undefined) schedule.scheduleValue = changes.scheduleValue
    if (changes.timezone !== undefined) schedule.timezone = changes.timezone
    if (changes.targetPayload !== undefined) {
      schedule.targetPayload = changes.targetPayload as Record<string, unknown> || null
    }
    if (changes.requireFeature !== undefined) schedule.requireFeature = changes.requireFeature || null
    if (changes.isEnabled !== undefined) schedule.isEnabled = changes.isEnabled
    
    // Recalculate next run if schedule changed
    if (changes.scheduleType !== undefined || changes.scheduleValue !== undefined || changes.timezone !== undefined) {
      const nextRunAt = calculateNextRun(
        schedule.scheduleType,
        schedule.scheduleValue,
        schedule.timezone
      )
      if (nextRunAt) {
        schedule.nextRunAt = nextRunAt
      }
    }
    
    schedule.updatedAt = new Date()
    await em.flush()
  }

  /**
   * Find schedules by module
   */
  async findByModule(moduleId: string): Promise<ScheduledJob[]> {
    const em = this.em()
    return em.find(ScheduledJob, { sourceModule: moduleId, deletedAt: null })
  }

  /**
   * Enable a schedule
   */
  async enable(scheduleId: string): Promise<void> {
    await this.update(scheduleId, { isEnabled: true })
  }

  /**
   * Disable a schedule
   */
  async disable(scheduleId: string): Promise<void> {
    await this.update(scheduleId, { isEnabled: false })
  }

  private validateScope(registration: ScheduleRegistration): void {
    const { scopeType, organizationId, tenantId } = registration
    
    if (scopeType === 'system') {
      if (organizationId || tenantId) {
        throw new Error('System-scoped schedules cannot have organizationId or tenantId')
      }
    } else if (scopeType === 'organization') {
      if (!organizationId || !tenantId) {
        throw new Error('Organization-scoped schedules must have both organizationId and tenantId')
      }
    } else if (scopeType === 'tenant') {
      if (organizationId || !tenantId) {
        throw new Error('Tenant-scoped schedules must have tenantId and no organizationId')
      }
    }
  }

  private validateTarget(registration: ScheduleRegistration): void {
    const { targetType, targetQueue, targetCommand } = registration
    
    if (targetType === 'queue') {
      if (!targetQueue) {
        throw new Error('Queue target must have targetQueue')
      }
    } else if (targetType === 'command') {
      if (!targetCommand) {
        throw new Error('Command target must have targetCommand')
      }
    }
  }
}
