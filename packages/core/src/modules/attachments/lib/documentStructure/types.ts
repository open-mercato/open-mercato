import { z } from 'zod'

export const documentSectionKinds = [
  'document',
  'part',
  'chapter',
  'section',
  'article',
  'clause',
  'paragraph',
  'list_item',
  'table',
  'annex',
  'page_unreadable',
] as const

export const documentSectionKindSchema = z.enum(documentSectionKinds)
export type DocumentSectionKind = z.infer<typeof documentSectionKindSchema>

export const documentExtractionStatuses = [
  'pending',
  'processing',
  'completed',
  'partial',
  'failed',
  'skipped',
] as const

export const documentExtractionStatusSchema = z.enum(documentExtractionStatuses)
export type ExtractionStatus = z.infer<typeof documentExtractionStatusSchema>

export const documentExtractionSkipReasons = [
  'unsupported_type',
  'no_text_layer_ocr_disabled',
  'too_large',
  'encrypted_pdf',
] as const

export const documentExtractionSkipReasonSchema = z.enum(documentExtractionSkipReasons)
export type ExtractionSkipReason = z.infer<typeof documentExtractionSkipReasonSchema>

export const documentStructureEngineNames = ['pdf_layout', 'docx', 'text', 'ocr', 'mixed'] as const

export const documentStructureEngineNameSchema = z.enum(documentStructureEngineNames)
export type DocumentStructureEngineName = z.infer<typeof documentStructureEngineNameSchema>

export const documentSectionSources = ['text_layer', 'ocr', 'docx', 'text'] as const

export const documentSectionSourceSchema = z.enum(documentSectionSources)
export type DocumentSectionSource = z.infer<typeof documentSectionSourceSchema>

export const documentOcrModes = ['auto', 'never', 'force'] as const

export const documentOcrModeSchema = z.enum(documentOcrModes)
export type DocumentOcrMode = z.infer<typeof documentOcrModeSchema>

export const DOCUMENT_STRUCTURE_ANCHOR_KEY_LENGTH = 32
export const DOCUMENT_STRUCTURE_NUMBER_LABEL_MAX_LENGTH = 64

const pageNumberSchema = z.number().int().min(1)
const charOffsetSchema = z.number().int().min(0)

export const documentAnchorKeySchema = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${DOCUMENT_STRUCTURE_ANCHOR_KEY_LENGTH}}$`))

export const documentBlockSchema = z.object({
  text: z.string(),
  page: pageNumberSchema.nullable(),
  source: documentSectionSourceSchema,
  fontSize: z.number().positive().nullable().optional(),
  bold: z.boolean().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  headingLevel: z.number().int().min(1).max(8).nullable().optional(),
  listDepth: z.number().int().min(0).nullable().optional(),
  isTable: z.boolean().optional(),
})
export type DocumentBlock = z.infer<typeof documentBlockSchema>

export const documentOutlineEntrySchema = z.object({
  title: z.string(),
  depth: z.number().int().min(1),
  page: pageNumberSchema.nullable(),
})
export type DocumentOutlineEntry = z.infer<typeof documentOutlineEntrySchema>

export const documentEngineResultSchema = z.object({
  blocks: z.array(documentBlockSchema),
  pageCount: z.number().int().min(0).nullable(),
  pageCharCounts: z.array(z.number().int().min(0)),
  outline: z.array(documentOutlineEntrySchema),
  ocrPageCount: z.number().int().min(0).default(0),
  unreadablePages: z.array(pageNumberSchema).default([]),
})
export type DocumentEngineResult = z.infer<typeof documentEngineResultSchema>

export const documentSectionNodeSchema = z
  .object({
    ordinal: z.number().int().min(0),
    depth: z.number().int().min(0),
    parentOrdinal: z.number().int().min(0).nullable(),
    kind: documentSectionKindSchema,
    numberLabel: z.string().min(1).max(DOCUMENT_STRUCTURE_NUMBER_LABEL_MAX_LENGTH).nullable(),
    heading: z.string().nullable(),
    headingPath: z.array(z.string()),
    text: z.string(),
    pageStart: pageNumberSchema.nullable(),
    pageEnd: pageNumberSchema.nullable(),
    charStart: charOffsetSchema,
    charEnd: charOffsetSchema,
    anchorKey: documentAnchorKeySchema,
    source: documentSectionSourceSchema,
  })
  .refine((node) => node.charEnd >= node.charStart, { message: 'charEnd must be >= charStart', path: ['charEnd'] })
  .refine(
    (node) => node.pageStart === null || node.pageEnd === null || node.pageEnd >= node.pageStart,
    { message: 'pageEnd must be >= pageStart', path: ['pageEnd'] },
  )
export type DocumentSectionNode = z.infer<typeof documentSectionNodeSchema>

export const documentStructureExtractionResultSchema = z.object({
  engine: documentStructureEngineNameSchema,
  engineVersion: z.number().int().min(1),
  status: documentExtractionStatusSchema,
  skipReason: documentExtractionSkipReasonSchema.nullable(),
  pageCount: z.number().int().min(0).nullable(),
  sectionCount: z.number().int().min(0),
  charCount: z.number().int().min(0),
  ocrPageCount: z.number().int().min(0),
  normalizedText: z.string(),
  sections: z.array(documentSectionNodeSchema),
})
export type DocumentStructureExtractionResult = z.infer<typeof documentStructureExtractionResultSchema>

export const documentSectionLocatorSchema = z
  .object({
    pageStart: pageNumberSchema.nullable(),
    pageEnd: pageNumberSchema.nullable(),
    region: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    section: z.string().min(1).nullable(),
    charStart: charOffsetSchema.nullable(),
    charEnd: charOffsetSchema.nullable(),
  })
  .refine((locator) => (locator.pageStart === null) === (locator.pageEnd === null), {
    message: 'pageStart and pageEnd must be set together',
    path: ['pageEnd'],
  })
  .refine(
    (locator) => locator.pageStart === null || locator.pageEnd === null || locator.pageEnd >= locator.pageStart,
    { message: 'pageEnd must be >= pageStart', path: ['pageEnd'] },
  )
  .refine((locator) => locator.region === null || locator.pageStart === locator.pageEnd, {
    message: 'region requires a single page',
    path: ['region'],
  })
  .refine((locator) => (locator.charStart === null) === (locator.charEnd === null), {
    message: 'charStart and charEnd must be set together',
    path: ['charEnd'],
  })
  .refine(
    (locator) => locator.charStart === null || locator.charEnd === null || locator.charEnd >= locator.charStart,
    { message: 'charEnd must be >= charStart', path: ['charEnd'] },
  )
  .refine(
    (locator) => locator.pageStart !== null || locator.section !== null || locator.charStart !== null,
    { message: 'locator must carry a page, a section or a char range' },
  )
export type DocumentSectionLocator = z.infer<typeof documentSectionLocatorSchema>

export type DocumentStructureEngineInput = {
  filePath: string
  mimeType: string
  extension?: string | null
  maxPages?: number
  ocr?: DocumentOcrMode
  ocrModel?: string | null
}

export interface DocumentStructureEngine {
  readonly id: DocumentStructureEngineName
  readonly version: number
  supports(mimeType: string, extension?: string | null): boolean
  extract(input: DocumentStructureEngineInput): Promise<DocumentEngineResult>
}
