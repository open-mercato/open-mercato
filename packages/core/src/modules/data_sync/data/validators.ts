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
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListSyncRunsQuery = z.infer<typeof listSyncRunsQuerySchema>
