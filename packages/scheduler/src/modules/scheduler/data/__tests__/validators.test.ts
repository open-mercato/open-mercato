import { describe, it, expect, beforeAll } from '@jest/globals'
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  scheduleDeleteSchema,
  scheduleListQuerySchema,
  scheduleTriggerSchema,
  scheduleRunsQuerySchema,
} from '../validators'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'

// Register a test command for validation tests
const testCommand: CommandHandler<any, any> = {
  id: 'test.command.for.validators',
  async execute() {
    return { ok: true }
  },
}

beforeAll(() => {
  registerCommand(testCommand)
})

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'

describe('scheduleCreateSchema', () => {
  describe('valid schedules', () => {
    it('should accept valid system-scoped cron schedule with queue target', () => {
      const result = scheduleCreateSchema.parse({
        name: 'Daily backup',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: 'backup-queue',
        isEnabled: true,
      })

      expect(result.name).toBe('Daily backup')
      expect(result.scopeType).toBe('system')
      expect(result.scheduleType).toBe('cron')
      expect(result.targetType).toBe('queue')
      expect(result.targetQueue).toBe('backup-queue')
    })

    it('should accept valid organization-scoped interval schedule with command target', () => {
      const result = scheduleCreateSchema.parse({
        name: 'Hourly sync',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: '1h',
        timezone: 'America/New_York',
        targetType: 'command',
        targetCommand: 'test.command.for.validators',
        targetPayload: { foo: 'bar' },
        isEnabled: true,
      })

      expect(result.name).toBe('Hourly sync')
      expect(result.scopeType).toBe('organization')
      expect(result.organizationId).toBe(organizationId)
      expect(result.tenantId).toBe(tenantId)
      expect(result.scheduleType).toBe('interval')
      expect(result.scheduleValue).toBe('1h')
      expect(result.targetType).toBe('command')
      expect(result.targetCommand).toBe('test.command.for.validators')
    })

    it('should accept valid tenant-scoped schedule', () => {
      const result = scheduleCreateSchema.parse({
        name: 'Tenant cleanup',
        scopeType: 'tenant',
        tenantId,
        scheduleType: 'interval',
        scheduleValue: '15m',
        targetType: 'queue',
        targetQueue: 'cleanup',
      })

      expect(result.scopeType).toBe('tenant')
      expect(result.tenantId).toBe(tenantId)
      expect(result.organizationId).toBeUndefined()
    })

    it('should apply default values', () => {
      const result = scheduleCreateSchema.parse({
        name: 'Test schedule',
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 * * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })

      expect(result.timezone).toBe('UTC')
      expect(result.isEnabled).toBe(true)
    })

    it('should accept various cron expressions', () => {
      const validCronExpressions = [
        '0 0 * * *',        // Daily at midnight
        '*/5 * * * *',      // Every 5 minutes
        '0 9-17 * * 1-5',   // Weekdays 9am-5pm
        '0 0 1 * *',        // First day of month
        '0 0 * * 0',        // Every Sunday
      ]

      validCronExpressions.forEach(scheduleValue => {
        const result = scheduleCreateSchema.parse({
          name: 'Test',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue,
          targetType: 'queue',
          targetQueue: 'test',
        })

        expect(result.scheduleValue).toBe(scheduleValue)
      })
    })

    it('should accept various interval formats', () => {
      const validIntervals = [
        '30s',  // 30 seconds
        '15m',  // 15 minutes
        '2h',   // 2 hours
        '1d',   // 1 day
      ]

      validIntervals.forEach(scheduleValue => {
        const result = scheduleCreateSchema.parse({
          name: 'Test',
          scopeType: 'system',
          scheduleType: 'interval',
          scheduleValue,
          targetType: 'queue',
          targetQueue: 'test',
        })

        expect(result.scheduleValue).toBe(scheduleValue)
      })
    })
  })

  describe('scope validation', () => {
    it('should reject system scope with organizationId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          organizationId,
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject system scope with tenantId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          tenantId,
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject organization scope without organizationId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'organization',
          tenantId,
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject organization scope without tenantId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'organization',
          organizationId,
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject tenant scope with organizationId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'tenant',
          organizationId,
          tenantId,
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject tenant scope without tenantId', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'tenant',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })
  })

  describe('target validation', () => {
    it('should reject queue target without targetQueue', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
        })
      ).toThrow()
    })

    it('should reject command target without targetCommand', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'command',
        })
      ).toThrow()
    })

    it('should reject non-existent command', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'command',
          targetCommand: 'this.command.does.not.exist',
        })
      ).toThrow(/Command does not exist/)
    })
  })

  describe('schedule validation', () => {
    it('should reject invalid cron expression', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: 'not a cron',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow(/Invalid schedule value/)
    })

    it('should reject invalid interval format - missing unit', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'interval',
          scheduleValue: '15',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow(/Invalid schedule value/)
    })

    it('should reject invalid interval format - invalid unit', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'interval',
          scheduleValue: '15x',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow(/Invalid schedule value/)
    })

    it('should reject invalid interval format - no number', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Invalid',
          scopeType: 'system',
          scheduleType: 'interval',
          scheduleValue: 'm',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow(/Invalid schedule value/)
    })
  })

  describe('field constraints', () => {
    it('should reject empty name', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: '',
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should reject name exceeding 200 characters', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'a'.repeat(201),
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })

    it('should accept name with exactly 200 characters', () => {
      const result = scheduleCreateSchema.parse({
        name: 'a'.repeat(200),
        scopeType: 'system',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
        targetType: 'queue',
        targetQueue: 'test',
      })

      expect(result.name.length).toBe(200)
    })

    it('should reject description exceeding 500 characters', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Test',
          description: 'a'.repeat(501),
          scopeType: 'system',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          targetType: 'queue',
          targetQueue: 'test',
        })
      ).toThrow()
    })
  })
})

describe('scheduleUpdateSchema', () => {
  const scheduleId = '123e4567-e89b-12d3-a456-426614174002'

  it('should accept partial updates', () => {
    const result = scheduleUpdateSchema.parse({
      id: scheduleId,
      name: 'Updated name',
    })

    expect(result.id).toBe(scheduleId)
    expect(result.name).toBe('Updated name')
    expect(result.scheduleType).toBeUndefined()
  })

  it('should require scheduleType when updating scheduleValue', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        scheduleValue: '0 0 * * *',
      })
    ).toThrow(/scheduleType is required/)
  })

  it('should validate scheduleValue with scheduleType', () => {
    const result = scheduleUpdateSchema.parse({
      id: scheduleId,
      scheduleType: 'cron',
      scheduleValue: '0 0 * * *',
    })

    expect(result.scheduleType).toBe('cron')
    expect(result.scheduleValue).toBe('0 0 * * *')
  })

  it('should reject invalid cron when updating', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        scheduleType: 'cron',
        scheduleValue: 'invalid',
      })
    ).toThrow(/Invalid schedule value/)
  })

  it('should reject invalid interval when updating', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        scheduleType: 'interval',
        scheduleValue: '15x',
      })
    ).toThrow(/Invalid schedule value/)
  })

  it('should require targetQueue when changing to queue target', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        targetType: 'queue',
      })
    ).toThrow(/corresponding targetQueue/)
  })

  it('should require targetCommand when changing to command target', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        targetType: 'command',
      })
    ).toThrow(/corresponding targetQueue or targetCommand/)
  })

  it('should accept valid command update', () => {
    const result = scheduleUpdateSchema.parse({
      id: scheduleId,
      targetType: 'command',
      targetCommand: 'test.command.for.validators',
    })

    expect(result.targetType).toBe('command')
    expect(result.targetCommand).toBe('test.command.for.validators')
  })

  it('should reject non-existent command on update', () => {
    expect(() =>
      scheduleUpdateSchema.parse({
        id: scheduleId,
        targetCommand: 'does.not.exist',
      })
    ).toThrow(/Command does not exist/)
  })

  it('should allow enabling/disabling schedule', () => {
    const result1 = scheduleUpdateSchema.parse({
      id: scheduleId,
      isEnabled: false,
    })

    const result2 = scheduleUpdateSchema.parse({
      id: scheduleId,
      isEnabled: true,
    })

    expect(result1.isEnabled).toBe(false)
    expect(result2.isEnabled).toBe(true)
  })

  it('should allow updating targetPayload', () => {
    const result = scheduleUpdateSchema.parse({
      id: scheduleId,
      targetPayload: { key: 'value', nested: { foo: 'bar' } },
    })

    expect(result.targetPayload).toEqual({ key: 'value', nested: { foo: 'bar' } })
  })

  it('should allow clearing targetPayload with null', () => {
    const result = scheduleUpdateSchema.parse({
      id: scheduleId,
      targetPayload: null,
    })

    expect(result.targetPayload).toBeNull()
  })
})

describe('scheduleDeleteSchema', () => {
  it('should accept valid UUID', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const result = scheduleDeleteSchema.parse({ id })

    expect(result.id).toBe(id)
  })

  it('should reject invalid UUID', () => {
    expect(() =>
      scheduleDeleteSchema.parse({ id: 'not-a-uuid' })
    ).toThrow()
  })

  it('should reject missing id', () => {
    expect(() =>
      scheduleDeleteSchema.parse({})
    ).toThrow()
  })
})

describe('scheduleListQuerySchema', () => {
  it('should apply default values', () => {
    const result = scheduleListQuerySchema.parse({})

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
  })

  it('should parse pagination parameters', () => {
    const result = scheduleListQuerySchema.parse({
      page: '3',
      pageSize: '50',
    })

    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(50)
  })

  it('should reject page less than 1', () => {
    expect(() =>
      scheduleListQuerySchema.parse({ page: '0' })
    ).toThrow()
  })

  it('should reject pageSize greater than 100', () => {
    expect(() =>
      scheduleListQuerySchema.parse({ pageSize: '101' })
    ).toThrow()
  })

  it('should parse filter parameters', () => {
    const result = scheduleListQuerySchema.parse({
      scopeType: 'tenant',
      isEnabled: 'true',
      sourceType: 'module',
      sourceModule: 'catalog',
      search: 'backup',
    })

    expect(result.scopeType).toBe('tenant')
    expect(result.isEnabled).toBe(true)
    expect(result.sourceType).toBe('module')
    expect(result.sourceModule).toBe('catalog')
    expect(result.search).toBe('backup')
  })

  it('should parse sort parameters', () => {
    const result = scheduleListQuerySchema.parse({
      sort: 'name',
      order: 'desc',
    })

    expect(result.sort).toBe('name')
    expect(result.order).toBe('desc')
  })

  it('should accept boolean values for isEnabled', () => {
    const result1 = scheduleListQuerySchema.parse({ isEnabled: true })
    const result2 = scheduleListQuerySchema.parse({ isEnabled: false })

    expect(result1.isEnabled).toBe(true)
    expect(result2.isEnabled).toBe(false)
  })
})

describe('scheduleTriggerSchema', () => {
  it('should accept valid schedule id', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const result = scheduleTriggerSchema.parse({ id })

    expect(result.id).toBe(id)
  })

  it('should accept optional userId', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const userId = '123e4567-e89b-12d3-a456-426614174001'
    const result = scheduleTriggerSchema.parse({ id, userId })

    expect(result.id).toBe(id)
    expect(result.userId).toBe(userId)
  })

  it('should reject invalid UUID for id', () => {
    expect(() =>
      scheduleTriggerSchema.parse({ id: 'not-a-uuid' })
    ).toThrow()
  })

  it('should reject invalid UUID for userId', () => {
    expect(() =>
      scheduleTriggerSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: 'not-a-uuid',
      })
    ).toThrow()
  })
})

describe('scheduleRunsQuerySchema', () => {
  it('should apply default values', () => {
    const result = scheduleRunsQuerySchema.parse({})

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
  })

  it('should parse filter parameters', () => {
    const scheduleId = '123e4567-e89b-12d3-a456-426614174000'
    const result = scheduleRunsQuerySchema.parse({
      scheduledJobId: scheduleId,
      status: 'completed',
      triggerType: 'manual',
      fromDate: '2025-01-01T00:00:00.000Z',
      toDate: '2025-12-31T23:59:59.999Z',
    })

    expect(result.scheduledJobId).toBe(scheduleId)
    expect(result.status).toBe('completed')
    expect(result.triggerType).toBe('manual')
    expect(result.fromDate).toBe('2025-01-01T00:00:00.000Z')
    expect(result.toDate).toBe('2025-12-31T23:59:59.999Z')
  })

  it('should accept all valid status values', () => {
    const statuses = ['running', 'completed', 'failed', 'skipped'] as const

    statuses.forEach(status => {
      const result = scheduleRunsQuerySchema.parse({ status })
      expect(result.status).toBe(status)
    })
  })

  it('should reject invalid status', () => {
    expect(() =>
      scheduleRunsQuerySchema.parse({ status: 'invalid' })
    ).toThrow()
  })

  it('should accept all valid trigger types', () => {
    const types = ['scheduled', 'manual'] as const

    types.forEach(triggerType => {
      const result = scheduleRunsQuerySchema.parse({ triggerType })
      expect(result.triggerType).toBe(triggerType)
    })
  })

  it('should reject invalid datetime format', () => {
    expect(() =>
      scheduleRunsQuerySchema.parse({ fromDate: 'not-a-date' })
    ).toThrow()
  })

  it('should parse sort parameters', () => {
    const result = scheduleRunsQuerySchema.parse({
      sort: 'startedAt',
      order: 'asc',
    })

    expect(result.sort).toBe('startedAt')
    expect(result.order).toBe('asc')
  })
})
