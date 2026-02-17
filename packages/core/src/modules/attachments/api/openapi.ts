import { z } from 'zod'

export const attachmentsTag = 'Attachments'

export const attachmentErrorSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .passthrough()

export const attachmentListItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int(),
  mimeType: z.string(),
  partitionCode: z.string(),
  partitionTitle: z.string().nullable(),
  url: z.string().nullable().optional(),
  createdAt: z.string(),
  tags: z.array(z.string()),
  assignments: z.array(z.unknown()),
  thumbnailUrl: z.string().optional(),
  content: z.unknown().nullable().optional(),
})

export const attachmentSchema = attachmentListItemSchema

export const attachmentListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1).describe('Page number for pagination'),
  pageSize: z.coerce.number().min(1).max(100).default(25).describe('Number of items per page (max 100)'),
  search: z.string().optional().describe('Search by file name (case-insensitive)'),
  partition: z.string().optional().describe('Filter by partition code'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)'),
  sortField: z.enum(['fileName', 'fileSize', 'createdAt']).optional().describe('Field to sort by'),
  sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
})

export const attachmentLibraryPartitionSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
})

export const attachmentListResponseSchema = z.object({
  items: z.array(attachmentListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  availableTags: z.array(z.string()),
  partitions: z.array(attachmentLibraryPartitionSchema),
})

export const attachmentDetailItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int(),
  mimeType: z.string(),
  partitionCode: z.string(),
  partitionTitle: z.string().nullable(),
  tags: z.array(z.string()),
  assignments: z.array(z.unknown()),
  content: z.unknown().nullable().optional(),
  customFields: z.unknown().nullable().optional(),
})

export const attachmentDetailResponseSchema = z.object({
  item: attachmentDetailItemSchema,
})

export const partitionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  requiresOcr: z.boolean(),
  ocrModel: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  envKey: z.string(),
})

export const partitionListResponseSchema = z.object({
  items: z.array(partitionSchema),
})

export const partitionCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe('Partition code (letters, numbers, dashes, underscores)'),
  title: z.string().min(1).max(120).describe('Partition title'),
  description: z.string().max(500).nullable().optional().describe('Optional description'),
  isPublic: z.boolean().optional().describe('Whether partition is publicly accessible'),
  requiresOcr: z.boolean().optional().describe('Whether OCR should be performed on uploads'),
  ocrModel: z.string().max(50).nullable().optional().describe('OCR model to use'),
})

export const partitionUpdateSchema = partitionCreateSchema.extend({
  id: z.string().uuid().describe('Partition ID'),
})

export const partitionResponseSchema = z.object({
  item: partitionSchema,
})

export const transferAttachmentsRequestSchema = z.object({
  entityId: z.string().min(1).describe('Entity type identifier'),
  attachmentIds: z.array(z.string().uuid()).min(1).describe('Array of attachment IDs to transfer'),
  fromRecordId: z.string().min(1).optional().describe('Optional source record ID'),
  toRecordId: z.string().min(1).describe('Target record ID'),
})

export const transferAttachmentsResponseSchema = z.object({
  ok: z.literal(true),
  updated: z.number().int().describe('Number of attachments transferred'),
})

export const imageQuerySchema = z.object({
  width: z.coerce.number().int().min(1).max(4000).optional().describe('Target width in pixels (max 4000)'),
  height: z.coerce.number().int().min(1).max(4000).optional().describe('Target height in pixels (max 4000)'),
  cropType: z.enum(['cover', 'contain']).optional().describe('Resize behavior: cover (crop to fill) or contain (fit within bounds)'),
})
