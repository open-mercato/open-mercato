import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { toQueryValueList } from '@open-mercato/shared/lib/crud/query-params'
import { documentOcrModeSchema, documentSectionKindSchema } from '../lib/documentStructure/types'
import type { AttachmentAccessResolver } from '../lib/access-types'

export const DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE =
  'Document sections can only be indexed when document structure extraction is enabled.'

const partitionFieldsSchema = z.object({
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
  storageDriver: z.enum(['local', 's3']).optional().default('local').describe('Storage driver to use'),
  configJson: z.record(z.string(), z.unknown()).nullable().optional().describe('Driver-specific configuration (e.g. S3 bucket, region, endpoint)'),
})

export type DocumentStructureFlags = {
  extractDocumentStructure?: boolean
  indexDocumentSections?: boolean
}

export function isDocumentStructureFlagCombinationValid(flags: DocumentStructureFlags): boolean {
  return !(flags.indexDocumentSections === true && flags.extractDocumentStructure !== true)
}

function refineDocumentStructureFlags(flags: DocumentStructureFlags, ctx: z.RefinementCtx) {
  if (flags.indexDocumentSections !== true || flags.extractDocumentStructure === undefined) return
  if (isDocumentStructureFlagCombinationValid(flags)) return
  ctx.addIssue({
    code: 'custom',
    path: ['indexDocumentSections'],
    message: DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE,
  })
}

export const partitionCreateSchema = partitionFieldsSchema
  .extend({
    extractDocumentStructure: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether uploads are parsed into a document outline and sections'),
    indexDocumentSections: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether extracted document sections are indexed in search (plaintext egress); requires extractDocumentStructure'),
  })
  .superRefine(refineDocumentStructureFlags)

export const partitionUpdateSchema = partitionFieldsSchema
  .extend({
    id: z.string().uuid().describe('Partition ID'),
    extractDocumentStructure: z
      .boolean()
      .optional()
      .describe('Whether uploads are parsed into a document outline and sections; omitted keeps the current value'),
    indexDocumentSections: z
      .boolean()
      .optional()
      .describe('Whether extracted document sections are indexed in search (plaintext egress); requires extractDocumentStructure; omitted keeps the current value'),
  })
  .superRefine(refineDocumentStructureFlags)

export type PartitionCreateInput = z.infer<typeof partitionCreateSchema>
export type PartitionUpdateInput = z.infer<typeof partitionUpdateSchema>

function queryBoolean(fallback: boolean) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? parseBooleanToken(value) ?? value : value),
    z.boolean().optional().default(fallback),
  )
}

function optionalQueryText(maxLength: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    z.string().trim().min(1).max(maxLength).optional(),
  )
}

export const documentStructureQuerySchema = z.object({
  includeOutline: queryBoolean(true).describe('Whether the outline tree is returned (default true)'),
  maxDepth: z.coerce.number().int().min(1).max(8).optional().default(4).describe('Deepest outline level returned (1-8, default 4)'),
})

export const documentSectionsQuerySchema = z.object({
  parentId: z.string().uuid().optional().describe('Only direct children of this section (or its subtree with includeDescendants)'),
  anchorKey: optionalQueryText(32).describe('Stable section anchor key'),
  numberLabel: optionalQueryText(64).describe('Exact normalized number label, e.g. 8.12 or §8.12'),
  page: z.coerce.number().int().min(1).optional().describe('Sections overlapping this 1-based page'),
  kinds: z
    .preprocess(
      (value) => (value === undefined ? undefined : toQueryValueList(value)),
      z.array(documentSectionKindSchema).optional(),
    )
    .describe('Comma-separated section kinds'),
  afterOrdinal: z.coerce.number().int().min(-1).optional().describe('Keyset cursor: return sections after this ordinal'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50).describe('Page size (1-100, default 50)'),
  includeText: queryBoolean(true).describe('Whether section text is returned (default true)'),
  includeDescendants: queryBoolean(false).describe('With parentId, return the whole subtree in document order'),
  maxCharsPerSection: z.coerce
    .number()
    .int()
    .min(100)
    .max(16000)
    .optional()
    .default(4000)
    .describe('Per-section text cap (100-16000, default 4000)'),
})

export const documentStructureRequestSchema = z.object({
  force: z.boolean().optional().describe('Re-extract even when a current extraction exists'),
  ocr: documentOcrModeSchema.optional().describe('OCR mode for pages without a text layer'),
})

export type DocumentStructureQuery = z.infer<typeof documentStructureQuerySchema>
export type DocumentSectionsQuery = z.infer<typeof documentSectionsQuerySchema>
export type DocumentStructureRequestInput = z.infer<typeof documentStructureRequestSchema>

export const attachmentStorageConfigurationSchema = z.custom<Record<string, unknown>>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
})

export const attachmentStorageScopeSchema = z.object({
  tenantId: z.string(),
  organizationId: z.string(),
}).refine((scope) => Boolean(scope.tenantId.trim()) === Boolean(scope.organizationId.trim()))

export const attachmentAccessActionSchema = z.enum(['read', 'render', 'metadata', 'reassign', 'delete', 'export'])
export const attachmentAccessSubjectFeaturesSchema = z.array(z.string())
export const attachmentAccessSelectorSchema = z.string().min(1).max(200).regex(/^(?:\*|[^*\s]+(?:\.\*)?)$/)
const resolverIdSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/)

export const attachmentAccessRequirementSchema = z.object({
  resolverId: resolverIdSchema,
  targetEntity: attachmentAccessSelectorSchema,
}).strict()

export const protectedAttachmentTargetSchema = attachmentAccessRequirementSchema.extend({
  targetPartition: attachmentAccessSelectorSchema,
})

export const attachmentAccessResolverSchema = z.object({
  id: resolverIdSchema,
  targetPartition: attachmentAccessSelectorSchema,
  targetEntity: attachmentAccessSelectorSchema.optional(),
  actions: z.array(attachmentAccessActionSchema).min(1).optional(),
  priority: z.number().finite().optional(),
  timeoutMs: z.number().int().min(1).max(15_000).optional(),
  resolve: z.custom<AttachmentAccessResolver['resolve']>((value) => typeof value === 'function'),
}).strict()

export const attachmentAccessRequirementsSchema = z.array(attachmentAccessRequirementSchema)
export const attachmentAccessDecisionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(504)]),
    reason: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/),
  }).strict(),
])
