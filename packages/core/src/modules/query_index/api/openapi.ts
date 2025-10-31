import { z } from 'zod'

export const queryIndexTag = 'Query Index'

export const queryIndexErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const queryIndexPartitionSchema = z.object({
  partitionIndex: z.number().int().nonnegative().nullable().optional(),
  partitionCount: z.number().int().positive().nullable().optional(),
  status: z.enum(['reindexing', 'purging', 'stalled', 'completed']),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  heartbeatAt: z.string().nullable().optional(),
  processedCount: z.number().int().nonnegative().nullable().optional(),
  totalCount: z.number().int().nonnegative().nullable().optional(),
})

export const queryIndexJobSchema = z.object({
  status: z.enum(['idle', 'reindexing', 'purging', 'stalled']),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  heartbeatAt: z.string().nullable().optional(),
  processedCount: z.number().int().nonnegative().nullable().optional(),
  totalCount: z.number().int().nonnegative().nullable().optional(),
  partitions: z.array(queryIndexPartitionSchema).optional(),
  scope: queryIndexPartitionSchema.pick({
    status: true,
    processedCount: true,
    totalCount: true,
  })
    .nullable()
    .optional(),
})

export const queryIndexStatusItemSchema = z.object({
  entityId: z.string(),
  label: z.string(),
  baseCount: z.number().int().nonnegative().nullable(),
  indexCount: z.number().int().nonnegative().nullable(),
  vectorCount: z.number().int().nonnegative().nullable().optional(),
  vectorEnabled: z.boolean().optional(),
  ok: z.boolean(),
  job: queryIndexJobSchema,
})

export const queryIndexErrorLogSchema = z.object({
  id: z.string(),
  source: z.string(),
  handler: z.string(),
  entityType: z.string().nullable(),
  recordId: z.string().nullable(),
  tenantId: z.string().nullable(),
  organizationId: z.string().nullable(),
  message: z.string(),
  stack: z.string().nullable(),
  payload: z.unknown().nullable(),
  occurredAt: z.string(),
})

export const queryIndexStatusLogSchema = z.object({
  id: z.string(),
  source: z.string(),
  handler: z.string(),
  level: z.enum(['info', 'warn']),
  entityType: z.string().nullable(),
  recordId: z.string().nullable(),
  tenantId: z.string().nullable(),
  organizationId: z.string().nullable(),
  message: z.string(),
  details: z.unknown().nullable(),
  occurredAt: z.string(),
})

export const queryIndexStatusResponseSchema = z.object({
  items: z.array(queryIndexStatusItemSchema),
  errors: z.array(queryIndexErrorLogSchema),
  logs: z.array(queryIndexStatusLogSchema),
})

export const queryIndexReindexRequestSchema = z.object({
  entityType: z.string().min(1),
  force: z.boolean().optional(),
  batchSize: z.number().int().positive().optional(),
  partitionCount: z.number().int().positive().optional(),
  partitionIndex: z.number().int().nonnegative().optional(),
})

export const queryIndexPurgeRequestSchema = z.object({
  entityType: z.string().min(1),
})

export const queryIndexOkSchema = z.object({
  ok: z.literal(true),
})
