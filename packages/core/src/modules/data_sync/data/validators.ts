import { z } from 'zod'
import { isValidScheduleInterval } from '@open-mercato/shared/lib/schedule/interval'
import { SCHEDULE_VALUE_FIELD, SCHEDULE_VALUE_FORMAT_MESSAGES } from '../lib/schedule-value'

export const runSyncSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
  fullSync: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(1000).default(100),
  triggeredBy: z.string().optional(),
  // Adapter-declared run parameters. Validated/coerced against the adapter's
  // `runParameters` declaration in the run route; here we only accept a record.
  parameters: z.record(z.string(), z.unknown()).optional(),
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
  search: z.string().trim().min(1).max(200).optional(),
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

/**
 * The documented interval format is part of the API contract, so a value the
 * scheduler can never run (`"3600"`) is rejected here instead of surfacing an
 * internal scheduler message from deep inside the write path. Cron is left to
 * the scheduler's own parser, which reports back through the same
 * `scheduleValue` field error.
 */
function refineScheduleValueFormat(
  value: { scheduleType?: 'cron' | 'interval'; scheduleValue?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.scheduleType !== 'interval' || typeof value.scheduleValue !== 'string') return
  if (isValidScheduleInterval(value.scheduleValue.trim())) return
  ctx.addIssue({
    code: 'custom',
    path: [SCHEDULE_VALUE_FIELD],
    message: SCHEDULE_VALUE_FORMAT_MESSAGES.interval,
  })
}

export const createSyncScheduleSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
  scheduleType: z.enum(['cron', 'interval']),
  scheduleValue: z.string().min(1),
  timezone: z.string().min(1).default('UTC'),
  fullSync: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
}).superRefine(refineScheduleValueFormat)

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
}).superRefine(refineScheduleValueFormat)

export type CreateSyncScheduleInput = z.infer<typeof createSyncScheduleSchema>
export type UpdateSyncScheduleInput = z.infer<typeof updateSyncScheduleSchema>
