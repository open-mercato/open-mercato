import { z } from 'zod'

export const progressJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])

export const createProgressJobSchema = z.object({
  jobType: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  totalCount: z.number().int().positive().optional(),
  cancellable: z.boolean().optional().default(false),
  meta: z.record(z.string(), z.unknown()).optional(),
  parentJobId: z.string().uuid().optional(),
  partitionIndex: z.number().int().min(0).optional(),
  partitionCount: z.number().int().positive().optional(),
})

export const updateProgressSchema = z.object({
  processedCount: z.number().int().min(0).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  totalCount: z.number().int().positive().optional(),
  etaSeconds: z.number().int().min(0).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export const completeJobSchema = z.object({
  resultSummary: z.record(z.string(), z.unknown()).optional(),
})

export const failJobSchema = z.object({
  errorMessage: z.string().max(2000),
  errorStack: z.string().max(10000).optional(),
})

export const listProgressJobsSchema = z.object({
  status: z.string().optional(),
  jobType: z.string().optional(),
  parentJobId: z.string().uuid().optional(),
  includeCompleted: z.enum(['true', 'false']).optional(),
  completedSince: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortField: z.enum(['createdAt', 'startedAt', 'finishedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export type CreateProgressJobInput = z.infer<typeof createProgressJobSchema>
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>
export type CompleteJobInput = z.infer<typeof completeJobSchema>
export type FailJobInput = z.infer<typeof failJobSchema>
export type ListProgressJobsInput = z.infer<typeof listProgressJobsSchema>
