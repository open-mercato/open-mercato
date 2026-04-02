import { z } from 'zod'

export const syncExcelEntityTypes = ['customers.person'] as const

export const syncExcelEntityTypeSchema = z.enum(syncExcelEntityTypes)

export const syncExcelPreviewRowSchema = z.record(z.string(), z.string().nullable())

export const syncExcelSuggestedFieldSchema = z.object({
  externalField: z.string().min(1),
  localField: z.string().min(1),
  transform: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  mappingKind: z.enum(['core', 'relation', 'external_id', 'custom_field', 'metadata', 'ignore']).optional(),
  dedupeRole: z.enum(['primary', 'secondary']).optional(),
})

export const syncExcelSuggestedMappingSchema = z.object({
  entityType: syncExcelEntityTypeSchema,
  matchStrategy: z.enum(['externalId', 'email', 'custom']),
  matchField: z.string().optional(),
  fields: z.array(syncExcelSuggestedFieldSchema),
  unmappedColumns: z.array(z.string()),
})

export const syncExcelUploadResponseSchema = z.object({
  uploadId: z.string().uuid(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  entityType: syncExcelEntityTypeSchema,
  headers: z.array(z.string()),
  sampleRows: z.array(syncExcelPreviewRowSchema),
  totalRows: z.number().int().nonnegative(),
  suggestedMapping: syncExcelSuggestedMappingSchema,
})

export const syncExcelPreviewQuerySchema = z.object({
  uploadId: z.string().uuid(),
  entityType: syncExcelEntityTypeSchema.optional(),
})

export const syncExcelImportRequestSchema = z.object({
  uploadId: z.string().uuid(),
  entityType: syncExcelEntityTypeSchema,
  mapping: syncExcelSuggestedMappingSchema,
  batchSize: z.number().int().min(1).max(1000).default(100).optional(),
})

export const syncExcelImportResponseSchema = z.object({
  runId: z.string().uuid(),
  progressJobId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
})

export type SyncExcelPreviewQuery = z.infer<typeof syncExcelPreviewQuerySchema>
export type SyncExcelImportRequest = z.infer<typeof syncExcelImportRequestSchema>
