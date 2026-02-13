import { z } from 'zod'
import { validateCron } from '../lib/cronParser'
import { validateInterval } from '../lib/intervalParser'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

/**
 * Validate that a command exists in the command registry
 */
function validateCommandExists(commandId: string): boolean {
  return commandRegistry.has(commandId)
}

/**
 * Base schedule fields
 */
const scheduleBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(500).optional().nullable(),
  
  scopeType: z.enum(['system', 'organization', 'tenant']),
  organizationId: z.uuid().optional().nullable(),
  tenantId: z.uuid().optional().nullable(),
  
  scheduleType: z.enum(['cron', 'interval']),
  scheduleValue: z.string().min(1, 'Schedule value is required'),
  timezone: z.string().default('UTC'),
  
  targetType: z.enum(['queue', 'command']),
  targetQueue: z.string().optional().nullable(),
  targetCommand: z.string().optional().nullable(),
  targetPayload: z.record(z.string(), z.unknown()).optional().nullable(),
  
  requireFeature: z.string().optional().nullable(),
  
  isEnabled: z.boolean().default(true),
  sourceType: z.enum(['user', 'module']).default('user'),
  sourceModule: z.string().optional().nullable(),
})

/**
 * Create schedule schema
 */
export const scheduleCreateSchema = scheduleBaseSchema
  .refine(
    (data) => {
      if (data.scopeType === 'system') {
        return !data.organizationId && !data.tenantId
      }
      if (data.scopeType === 'organization') {
        return !!data.organizationId && !!data.tenantId
      }
      if (data.scopeType === 'tenant') {
        return !data.organizationId && !!data.tenantId
      }
      return false
    },
    {
      message: 'Invalid scope configuration',
      path: ['scopeType'],
    }
  )
  .refine(
    (data) => {
      if (data.targetType === 'queue') {
        return !!data.targetQueue
      }
      if (data.targetType === 'command') {
        return !!data.targetCommand
      }
      return false
    },
    {
      message: 'Target queue or command is required based on target type',
      path: ['targetType'],
    }
  )
  .refine(
    (data) => {
      if (data.scheduleType === 'cron') {
        return validateCron(data.scheduleValue)
      }
      if (data.scheduleType === 'interval') {
        return validateInterval(data.scheduleValue)
      }
      return false
    },
    {
      message: 'Invalid schedule value. For cron: use valid cron expression (e.g., "0 0 * * *"). For interval: use <number><unit> format (e.g., "15m", "2h", "1d")',
      path: ['scheduleValue'],
    }
  )
  .refine(
    (data) => {
      // Validate that command exists if targetType is 'command'
      if (data.targetType === 'command' && data.targetCommand) {
        return validateCommandExists(data.targetCommand)
      }
      return true
    },
    {
      message: 'Command does not exist. Please ensure the command is registered before creating a schedule.',
      path: ['targetCommand'],
    }
  )

/**
 * Update schedule schema (all fields optional except id)
 */
export const scheduleUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  
  scheduleType: z.enum(['cron', 'interval']).optional(),
  scheduleValue: z.string().min(1).optional(),
  timezone: z.string().optional(),
  
  targetType: z.enum(['queue', 'command']).optional(),
  targetQueue: z.string().optional().nullable(),
  targetCommand: z.string().optional().nullable(),
  targetPayload: z.record(z.string(), z.unknown()).optional().nullable(),
  requireFeature: z.string().optional().nullable(),
  
  isEnabled: z.boolean().optional(),
})
  .refine(
    (data) => {
      // If scheduleValue is provided, scheduleType must also be provided
      // This ensures we can validate the value against its type
      if (data.scheduleValue !== undefined && data.scheduleType === undefined) {
        return false
      }
      return true
    },
    {
      message: 'scheduleType is required when updating scheduleValue',
      path: ['scheduleType'],
    }
  )
  .refine(
    (data) => {
      // If scheduleValue is provided, validate it based on scheduleType
      if (data.scheduleValue && data.scheduleType) {
        if (data.scheduleType === 'cron') {
          return validateCron(data.scheduleValue)
        }
        if (data.scheduleType === 'interval') {
          return validateInterval(data.scheduleValue)
        }
      }
      return true
    },
    {
      message: 'Invalid schedule value. For cron: use valid cron expression (e.g., "0 0 * * *"). For interval: use <number><unit> format (e.g., "15m", "2h", "1d")',
      path: ['scheduleValue'],
    }
  )
  .refine(
    (data) => {
      // If targetType is provided, ensure appropriate target is set
      if (data.targetType === 'queue') {
        return data.targetQueue !== undefined
      }
      if (data.targetType === 'command') {
        return data.targetCommand !== undefined
      }
      return true
    },
    {
      message: 'When changing target type, you must provide the corresponding targetQueue or targetCommand',
      path: ['targetType'],
    }
  )
  .refine(
    (data) => {
      // Validate that command exists if targetCommand is provided
      if (data.targetCommand) {
        return validateCommandExists(data.targetCommand)
      }
      return true
    },
    {
      message: 'Command does not exist. Please ensure the command is registered before updating.',
      path: ['targetCommand'],
    }
  )

/**
 * Delete schedule schema
 */
export const scheduleDeleteSchema = z.object({
  id: z.uuid(),
})

/**
 * List schedules query schema
 */
export const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  id: z.string().uuid().optional(),
  search: z.string().optional(),
  scopeType: z.enum(['system', 'organization', 'tenant']).optional(),
  isEnabled: z.string().optional().transform((val) => {
    if (val === undefined) return undefined
    return parseBooleanToken(val) ?? undefined
  }),
  sourceType: z.enum(['user', 'module']).optional(),
  sourceModule: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

/**
 * Trigger schedule schema (manual execution)
 */
export const scheduleTriggerSchema = z.object({
  id: z.uuid(),
})

/**
 * Get schedule runs query schema
 */
export const scheduleRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  scheduledJobId: z.uuid().optional(),
  status: z.enum(['running', 'completed', 'failed', 'skipped']).optional(),
  triggerType: z.enum(['scheduled', 'manual']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

/**
 * Type exports
 */
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteSchema>
export type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>
export type ScheduleTriggerInput = z.infer<typeof scheduleTriggerSchema>
export type ScheduleRunsQuery = z.infer<typeof scheduleRunsQuerySchema>
