import { z } from 'zod'

const dataClassIdSchema = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/)
const subjectSchema = z.object({
  kind: z.string().trim().min(1).max(120),
  id: z.string().trim().min(1).max(255),
})

export const retentionPolicyCreateSchema = z.object({
  dataClassId: dataClassIdSchema,
  retentionDays: z.number().int().min(1).max(36_500),
  action: z.enum(['delete', 'anonymize']),
  batchSize: z.number().int().min(1).max(1_000).default(100),
  isActive: z.boolean().default(true),
})

export const retentionPolicyUpdateSchema = z.object({
  retentionDays: z.number().int().min(1).max(36_500).optional(),
  action: z.enum(['delete', 'anonymize']).optional(),
  batchSize: z.number().int().min(1).max(1_000).optional(),
  isActive: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, { message: 'At least one field is required' })

export const legalHoldCreateSchema = z.object({
  dataClassId: dataClassIdSchema.optional(),
  subject: subjectSchema.optional(),
  reason: z.string().trim().min(1).max(2_000),
  expiresAt: z.coerce.date().optional(),
}).refine((input) => Boolean(input.dataClassId || input.subject), {
  message: 'A data class or subject is required',
})

export const retentionRunSchema = z.object({
  policyId: z.string().uuid(),
  dryRun: z.boolean().default(true),
  maxBatches: z.number().int().min(1).max(100).default(20),
})

export const subjectRequestSchema = z.object({
  action: z.enum(['discover', 'export', 'erase', 'anonymize']),
  subject: subjectSchema,
  dataClassIds: z.array(dataClassIdSchema).max(100).optional(),
  dryRun: z.boolean().default(true),
})

export const operationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  type: z.enum(['retention', 'discover', 'export', 'erase', 'anonymize']).optional(),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'blocked']).optional(),
})

export type RetentionPolicyCreateInput = z.infer<typeof retentionPolicyCreateSchema>
export type RetentionPolicyUpdateInput = z.infer<typeof retentionPolicyUpdateSchema>
export type LegalHoldCreateInput = z.infer<typeof legalHoldCreateSchema>
export type RetentionRunInput = z.infer<typeof retentionRunSchema>
export type SubjectRequestInput = z.infer<typeof subjectRequestSchema>
