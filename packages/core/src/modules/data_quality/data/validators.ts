import { z } from 'zod'

export const severitySchema = z.enum(['info', 'warning', 'error', 'critical'])
export const scanStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
export const findingStatusSchema = z.enum(['open', 'resolved', 'ignored'])

// Check schemas
export const createCheckSchema = z.object({
  code: z.string().min(1).max(100).regex(/^[a-z0-9_.]+$/, 'Code must be lowercase alphanumeric with dots and underscores'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  targetEntityType: z.string().min(1).max(100),
  failureExpression: z.record(z.string(), z.unknown()),
  severity: severitySchema,
  weight: z.number().int().min(1).max(100).default(1),
  enabled: z.boolean().default(true),
})

export const updateCheckSchema = createCheckSchema.partial().omit({ code: true })

// Suite schemas
export const createSuiteSchema = z.object({
  code: z.string().min(1).max(100).regex(/^[a-z0-9_.]+$/, 'Code must be lowercase alphanumeric with dots and underscores'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  enabled: z.boolean().default(true),
})

export const updateSuiteSchema = createSuiteSchema.partial().omit({ code: true })

// Suite check membership
export const assignSuiteChecksSchema = z.object({
  checkIds: z.array(z.string().uuid()).min(1).max(200),
  mode: z.enum(['replace', 'append']).default('replace'),
})

// Scan schemas
export const startScanSchema = z.object({
  suiteId: z.string().uuid().optional(),
  checkIds: z.array(z.string().uuid()).optional(),
  targetEntityType: z.string().min(1).max(100).optional(),
  filters: z.object({
    ids: z.array(z.string().uuid()).max(10000).optional(),
  }).optional(),
}).refine(
  (data) => data.suiteId || (data.checkIds && data.checkIds.length > 0),
  { message: 'Either suiteId or checkIds must be provided' }
)

// Finding action schemas
export const resolveFindingSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, { message: 'Confirmation required' }),
})

export const ignoreFindingSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, { message: 'Confirmation required' }),
})

// List/filter schemas
export const listChecksSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  targetEntityType: z.string().optional(),
  severity: z.string().optional(),
  enabled: z.string().optional(),
  ids: z.string().optional(),
})

export const listSuitesSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  enabled: z.string().optional(),
  ids: z.string().optional(),
})

export const listScansSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  id: z.string().uuid().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
  suiteId: z.string().uuid().optional(),
  targetEntityType: z.string().optional(),
})

export const listFindingsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  severity: z.string().optional(),
  targetEntityType: z.string().optional(),
  targetRecordId: z.string().optional(),
  checkId: z.string().uuid().optional(),
  scanRunId: z.string().uuid().optional(),
  ids: z.string().optional(),
})

// Type exports
export type CreateCheckInput = z.infer<typeof createCheckSchema>
export type UpdateCheckInput = z.infer<typeof updateCheckSchema>
export type CreateSuiteInput = z.infer<typeof createSuiteSchema>
export type UpdateSuiteInput = z.infer<typeof updateSuiteSchema>
export type AssignSuiteChecksInput = z.infer<typeof assignSuiteChecksSchema>
export type StartScanInput = z.infer<typeof startScanSchema>
export type ListChecksInput = z.infer<typeof listChecksSchema>
export type ListSuitesInput = z.infer<typeof listSuitesSchema>
export type ListScansInput = z.infer<typeof listScansSchema>
export type ListFindingsInput = z.infer<typeof listFindingsSchema>
