import { z } from 'zod'

export const attachmentsTag = 'Attachments'

// ============================================================================
// Common Schemas
// ============================================================================

export const attachmentErrorSchema = z
  .object({
    error: z.string(),
    details: z.any().optional(),
  })
  .passthrough()

// ============================================================================
// Attachment Schemas
// ============================================================================

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  entityId: z.string(),
  recordId: z.string(),
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  partitionCode: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number().int(),
  storageDriver: z.string(),
  storagePath: z.string(),
  tags: z.array(z.string()).nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  assignmentDetails: z.any().nullable().optional(),
  createdAt: z.string(),
})

export const attachmentListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1).describe('Page number for pagination'),
  pageSize: z.coerce.number().min(1).max(100).default(25).describe('Number of items per page (max 100)'),
  search: z.string().optional().describe('Search by file name (case-insensitive)'),
  partition: z.string().optional().describe('Filter by partition code'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)'),
  sortField: z.enum(['fileName', 'fileSize', 'createdAt']).optional().describe('Field to sort by'),
  sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
})

export const attachmentListResponseSchema = z.object({
  items: z.array(attachmentSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().positive(),
})

export const attachmentDetailResponseSchema = z.object({
  data: attachmentSchema,
})

// ============================================================================
// Partition Schemas
// ============================================================================

export const partitionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  storageDriver: z.string(),
  configJson: z.record(z.string(), z.unknown()).nullable().optional(),
  isPublic: z.boolean(),
  requiresOcr: z.boolean(),
  ocrModel: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const partitionListResponseSchema = z.object({
  data: z.array(partitionSchema),
})

// ============================================================================
// Transfer Schemas
// ============================================================================

export const transferRequestSchema = z.object({
  attachmentId: z.string().uuid().describe('Attachment ID to transfer'),
  targetPartitionCode: z.string().describe('Target partition code'),
})

export const transferResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  attachment: attachmentSchema.optional(),
})
