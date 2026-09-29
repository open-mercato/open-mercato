import { z } from 'zod'
import {
  DOCUMENTS_MAX_CONTENT_HTML_BYTES,
  DOCUMENTS_MAX_CONTENT_TEXT_BYTES,
  isUtf8WithinLimit,
} from '../lib/resourceLimits'
import { containsCanonicalUuid } from '../lib/displayLabels'
import { DOCUMENT_VERSION_LABEL_MAX_LENGTH } from '../lib/versionLabels'

const uuid = () => z.string().uuid('documents.validation.common.invalidUuid')

function blankStringToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredTrimmedString(max: number, message: string) {
  return z.string().trim().min(1, { message }).max(max)
}

export const documentEntityLabelSchema = requiredTrimmedString(
  512,
  'documents.validation.links.labelRequired',
).refine((label) => !containsCanonicalUuid(label), {
  message: 'documents.validation.links.readableLabelRequired',
})

export const documentVersionLabelSchema = z.preprocess(
  blankStringToNull,
  z.string()
    .trim()
    .max(DOCUMENT_VERSION_LABEL_MAX_LENGTH)
    .refine((label) => !containsCanonicalUuid(label), {
      message: 'documents.validation.versions.readableLabelRequired',
    })
    .optional()
    .nullable(),
)

const clearableUuidSchema = z.preprocess(
  blankStringToNull,
  uuid().optional().nullable(),
)

const finiteNumberSchema = z.number().refine(Number.isFinite, {
  message: 'documents.validation.templates.finiteNumberRequired',
})

const localeSchema = z.string().trim().min(2).max(64).superRefine((value, context) => {
  try {
    new Intl.Locale(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'documents.validation.templates.invalidLocale' })
  }
})

const relativePositionSchema = z.string().min(1).max(4096).regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  'documents.validation.comment.invalidAnchor',
)

const legacyNumericAnchorSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
}).strict().refine((anchor) => anchor.to >= anchor.from, {
  message: 'documents.validation.comment.invalidAnchor',
})

const relativeAnchorSchema = z.object({
  version: z.literal(2),
  relativeFrom: relativePositionSchema,
  relativeTo: relativePositionSchema,
}).strict()

export const documentCommentAnchorWriteSchema = z.union([
  legacyNumericAnchorSchema,
  relativeAnchorSchema,
])

export type DocumentCommentAnchor = z.infer<typeof documentCommentAnchorWriteSchema>

export const documentSharePrincipalTypeSchema = z.enum(['user', 'role'])
export const documentSharePermissionSchema = z.enum(['viewer', 'commenter', 'editor'])
export const documentEntityTypeSchema = z.enum([
  'customer-person',
  'customer-company',
  'deal',
  'product',
  'catalog-offer',
  'quote',
  'sales-order',
  'document',
])
export const documentEntityLinkSourceSchema = z.enum(['chip', 'template', 'related-panel'])
export const documentTitleSchema = requiredTrimmedString(512, 'documents.validation.title.required')

export const documentCreateSchema = z.object({
  title: documentTitleSchema,
  folderId: clearableUuidSchema,
})

export const documentUpdateSchema = z.object({
  id: uuid(),
  title: documentTitleSchema.optional(),
  folderId: clearableUuidSchema,
})

export const documentFolderCreateSchema = z.object({
  name: requiredTrimmedString(256, 'documents.validation.folder.nameRequired'),
  parentFolderId: clearableUuidSchema,
})

export const documentFolderUpdateSchema = z.object({
  id: uuid(),
  name: requiredTrimmedString(256, 'documents.validation.folder.nameRequired').optional(),
  parentFolderId: clearableUuidSchema,
})

export const documentShareCreateSchema = z.object({
  principalType: documentSharePrincipalTypeSchema,
  principalId: uuid(),
  permission: documentSharePermissionSchema,
})

export const documentShareUpdateSchema = z.object({
  id: uuid(),
  permission: documentSharePermissionSchema,
})

export const documentCommentCreateSchema = z.object({
  body: requiredTrimmedString(8000, 'documents.validation.comment.bodyRequired'),
  anchor: documentCommentAnchorWriteSchema.optional().nullable(),
  mentions: z.array(z.object({ userId: z.string().uuid() })).max(50).optional(),
  grantAccessTo: z.array(uuid()).max(50).optional(),
  parentCommentId: clearableUuidSchema,
})

const documentHtmlSchema = z.string().refine(
  (value) => isUtf8WithinLimit(value, DOCUMENTS_MAX_CONTENT_HTML_BYTES),
  { message: 'documents.validation.content.tooLarge' },
)
const documentTemplateHtmlSchema = z.string().max(500000).refine(
  (value) => isUtf8WithinLimit(value, DOCUMENTS_MAX_CONTENT_HTML_BYTES),
  { message: 'documents.validation.content.tooLarge' },
)

export const documentContentPutSchema = z.object({
  contentHtml: documentHtmlSchema,
  contentText: z.string().refine(
    (value) => isUtf8WithinLimit(value, DOCUMENTS_MAX_CONTENT_TEXT_BYTES),
    { message: 'documents.validation.content.tooLarge' },
  ).optional().nullable(),
})

export const documentTemplateContextSlotSchema = z.object({
  slot: z.string().min(1).max(64).regex(/^[a-z][a-zA-Z0-9]*$/),
  entityType: documentEntityTypeSchema,
  required: z.boolean().optional(),
})

export const documentTemplateContextSlotsSchema = z.array(documentTemplateContextSlotSchema).max(20).superRefine(
  (slots, context) => {
    const seen = new Set<string>()
    for (const [index, slot] of slots.entries()) {
      if (seen.has(slot.slot)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'slot'],
          message: 'documents.validation.templates.duplicateSlot',
        })
      }
      seen.add(slot.slot)
    }
  },
)

export const documentTemplateCreateSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).nullish(),
  bodyHtml: documentTemplateHtmlSchema,
  contextSlots: documentTemplateContextSlotsSchema.nullish(),
  isActive: z.boolean().optional(),
})

export const documentTemplateUpdateSchema = z.object({
  id: uuid(),
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2000).nullish(),
  bodyHtml: documentTemplateHtmlSchema.optional(),
  contextSlots: documentTemplateContextSlotsSchema.nullish(),
  isActive: z.boolean().optional(),
})

export const documentEntityLinkCreateSchema = z.object({
  entityType: documentEntityTypeSchema,
  entityId: uuid(),
  label: documentEntityLabelSchema,
  href: z.string().trim().min(1).max(1024).startsWith('/backend/'),
  source: documentEntityLinkSourceSchema,
})

export const documentTemplateFillSlotSchema = z.object({
  slot: z.string().min(1).max(64).regex(/^[a-z][a-zA-Z0-9]*$/),
  entityType: documentEntityTypeSchema,
  entityId: uuid(),
  label: documentEntityLabelSchema,
  href: z.string().trim().min(1).max(1024).startsWith('/backend/'),
  values: z.record(z.string().min(1).max(64), z.union([
    z.string().max(10000),
    finiteNumberSchema,
    z.null(),
  ])),
})

const documentTemplateRenderBaseSchema = z.object({
  templateUpdatedAt: z.string().datetime({ offset: true }),
  title: documentTitleSchema,
  locale: localeSchema,
  effectiveDate: z.string().datetime({ offset: true }),
  slots: z.array(documentTemplateFillSlotSchema).max(20),
})

export const documentTemplatePreviewSchema = documentTemplateRenderBaseSchema

export const documentTemplateInstantiateSchema = documentTemplateRenderBaseSchema.extend({
  templateId: uuid(),
  folderId: clearableUuidSchema,
  previewDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
})

export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
export type DocumentFolderCreateInput = z.infer<typeof documentFolderCreateSchema>
export type DocumentFolderUpdateInput = z.infer<typeof documentFolderUpdateSchema>
export type DocumentShareCreateInput = z.infer<typeof documentShareCreateSchema>
export type DocumentShareUpdateInput = z.infer<typeof documentShareUpdateSchema>
export type DocumentCommentCreateInput = z.infer<typeof documentCommentCreateSchema>
export type DocumentContentPutInput = z.infer<typeof documentContentPutSchema>
export type DocumentTemplateContextSlotInput = z.infer<typeof documentTemplateContextSlotSchema>
export type DocumentTemplateCreateInput = z.infer<typeof documentTemplateCreateSchema>
export type DocumentTemplateUpdateInput = z.infer<typeof documentTemplateUpdateSchema>
export type DocumentEntityType = z.infer<typeof documentEntityTypeSchema>
export type DocumentEntityLinkSourceInput = z.infer<typeof documentEntityLinkSourceSchema>
export type DocumentEntityLinkCreateInput = z.infer<typeof documentEntityLinkCreateSchema>
export type DocumentTemplateFillSlotInput = z.infer<typeof documentTemplateFillSlotSchema>
export type DocumentTemplatePreviewInput = z.infer<typeof documentTemplatePreviewSchema>
export type DocumentTemplateInstantiateInput = z.infer<typeof documentTemplateInstantiateSchema>
