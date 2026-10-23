import { z } from 'zod'

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
