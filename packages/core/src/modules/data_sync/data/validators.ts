import { z } from 'zod'

export const runSyncSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
  fullSync: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(1000).default(100),
  triggeredBy: z.string().optional(),
})

export type RunSyncInput = z.infer<typeof runSyncSchema>

export const retrySyncSchema = z.object({
  fromBeginning: z.boolean().default(false),
})

export type RetrySyncInput = z.infer<typeof retrySyncSchema>

export const validateConnectionSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
})

export const listSyncRunsQuerySchema = z.object({
  integrationId: z.string().optional(),
  entityType: z.string().optional(),
  direction: z.enum(['import', 'export']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListSyncRunsQuery = z.infer<typeof listSyncRunsQuerySchema>

export const listSyncSchedulesQuerySchema = z.object({
  integrationId: z.string().optional(),
  entityType: z.string().optional(),
  direction: z.enum(['import', 'export']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const createSyncScheduleSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
  scheduleType: z.enum(['cron', 'interval']),
  scheduleValue: z.string().min(1),
  timezone: z.string().min(1).default('UTC'),
  fullSync: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
})

export const updateSyncScheduleSchema = z.object({
  integrationId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  direction: z.enum(['import', 'export']).optional(),
  scheduleType: z.enum(['cron', 'interval']).optional(),
  scheduleValue: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  fullSync: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be updated',
})

export type CreateSyncScheduleInput = z.infer<typeof createSyncScheduleSchema>
export type UpdateSyncScheduleInput = z.infer<typeof updateSyncScheduleSchema>
