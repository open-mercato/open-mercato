import { z } from 'zod'

const runSyncFields = {
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  direction: z.enum(['import', 'export']),
  fullSync: z.boolean().default(false),
  triggeredBy: z.string().optional(),
  // Adapter-declared run parameters. Validated/coerced against the adapter's
  // `runParameters` declaration in the run route; here we only accept a record.
  parameters: z.record(z.string(), z.unknown()).optional(),
}

/**
 * @deprecated Use {@link runSyncRequestSchema}, which leaves `batchSize` absent
 * when the caller named none so `startDataSyncRun` can answer with the adapter's
 * `defaultBatchSize(entityType)`. This schema substitutes 100 for an omitted
 * value, which shadows that declaration. Kept unchanged for out-of-tree callers
 * and slated for removal no earlier than one minor version after 0.9.0.
 */
export const runSyncSchema = z.object({
  ...runSyncFields,
  batchSize: z.number().int().min(1).max(1000).default(100),
})

/** @deprecated Derived from {@link runSyncSchema}; use `RunSyncRequestInput`. */
export type RunSyncInput = z.infer<typeof runSyncSchema>

/**
 * The shape the run route parses. Identical to `runSyncSchema` except that an
 * omitted `batchSize` stays omitted: the route cannot otherwise tell "the
 * operator asked for 100" from "nobody named a page size", and only the second
 * may be answered by the adapter's declared default.
 */
export const runSyncRequestSchema = z.object({
  ...runSyncFields,
  batchSize: z.number().int().min(1).max(1000).optional(),
})

export type RunSyncRequestInput = z.infer<typeof runSyncRequestSchema>

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
