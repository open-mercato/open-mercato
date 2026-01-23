import { z } from 'zod'
import { validateCron } from '../services/cronParser'
import { validateInterval } from '../services/intervalParser'

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
  
  targetPayload: z.record(z.string(), z.unknown()).optional().nullable(),
  requireFeature: z.string().optional().nullable(),
  
  isEnabled: z.boolean().optional(),
})
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
  search: z.string().optional(),
  scopeType: z.enum(['system', 'organization', 'tenant']).optional(),
  isEnabled: z.coerce.boolean().optional(),
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
  userId: z.uuid().optional(),
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
