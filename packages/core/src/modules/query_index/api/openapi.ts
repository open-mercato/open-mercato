import { z } from 'zod'

export const queryIndexTag = 'Query Index'

export const queryIndexErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const queryIndexJobSchema = z.object({
  status: z.enum(['idle', 'reindexing', 'purging']),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
})

export const queryIndexStatusItemSchema = z.object({
  entityId: z.string(),
  label: z.string(),
  baseCount: z.number().int().nonnegative(),
  indexCount: z.number().int().nonnegative(),
  ok: z.boolean(),
  job: queryIndexJobSchema,
})

export const queryIndexStatusResponseSchema = z.object({
  items: z.array(queryIndexStatusItemSchema),
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
