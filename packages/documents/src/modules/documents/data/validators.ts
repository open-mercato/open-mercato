import { z } from 'zod'

const uuid = () => z.string().uuid('documents.validation.common.invalidUuid')

function blankStringToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredTrimmedString(max: number, message: string) {
  return z.string().trim().min(1, { message }).max(max)
}

const clearableUuidSchema = z.preprocess(
  blankStringToNull,
  uuid().optional().nullable(),
)

const anchorSchema = z.record(z.string(), z.unknown())

export const documentSharePrincipalTypeSchema = z.enum(['user', 'role'])
export const documentSharePermissionSchema = z.enum(['viewer', 'commenter', 'editor'])

export const documentCreateSchema = z.object({
  title: requiredTrimmedString(512, 'documents.validation.title.required'),
  folderId: clearableUuidSchema,
})

export const documentUpdateSchema = z.object({
  id: uuid(),
  title: requiredTrimmedString(512, 'documents.validation.title.required').optional(),
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
  anchor: anchorSchema.optional().nullable(),
  mentions: z.array(z.object({ userId: z.string().uuid() })).max(50).optional(),
  grantAccessTo: z.array(uuid()).max(50).optional(),
  parentCommentId: clearableUuidSchema,
})

export const documentCommentUpdateSchema = z.object({
  id: uuid(),
  body: requiredTrimmedString(8000, 'documents.validation.comment.bodyRequired').optional(),
  anchor: anchorSchema.optional().nullable(),
  resolved: z.boolean().optional(),
})

export const documentContentPutSchema = z.object({
  contentHtml: z.string(),
  contentText: z.string().optional().nullable(),
})

export const documentTemplateContextSlotSchema = z.object({
  slot: z.string().min(1).max(64).regex(/^[a-z][a-zA-Z0-9]*$/),
  entityType: z.enum(['customer-person', 'customer-company', 'deal', 'product', 'quote']),
  required: z.boolean().optional(),
})

export const documentTemplateCreateSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).nullish(),
  bodyHtml: z.string().max(500000),
  contextSlots: z.array(documentTemplateContextSlotSchema).max(10).nullish(),
  isActive: z.boolean().optional(),
})

export const documentTemplateUpdateSchema = z.object({
  id: uuid(),
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2000).nullish(),
  bodyHtml: z.string().max(500000).optional(),
  contextSlots: z.array(documentTemplateContextSlotSchema).max(10).nullish(),
  isActive: z.boolean().optional(),
})

export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
export type DocumentFolderCreateInput = z.infer<typeof documentFolderCreateSchema>
export type DocumentFolderUpdateInput = z.infer<typeof documentFolderUpdateSchema>
export type DocumentShareCreateInput = z.infer<typeof documentShareCreateSchema>
export type DocumentShareUpdateInput = z.infer<typeof documentShareUpdateSchema>
export type DocumentCommentCreateInput = z.infer<typeof documentCommentCreateSchema>
export type DocumentCommentUpdateInput = z.infer<typeof documentCommentUpdateSchema>
export type DocumentContentPutInput = z.infer<typeof documentContentPutSchema>
export type DocumentTemplateContextSlotInput = z.infer<typeof documentTemplateContextSlotSchema>
export type DocumentTemplateCreateInput = z.infer<typeof documentTemplateCreateSchema>
export type DocumentTemplateUpdateInput = z.infer<typeof documentTemplateUpdateSchema>
