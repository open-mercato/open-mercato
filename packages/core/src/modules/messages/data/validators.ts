import { z } from 'zod'

function collectDuplicateRecipientIds(
  recipients: Array<{ userId: string }>,
): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const recipient of recipients) {
    if (seen.has(recipient.userId)) {
      duplicates.add(recipient.userId)
      continue
    }
    seen.add(recipient.userId)
  }
  return Array.from(duplicates)
}

export const messageRecipientSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['to', 'cc', 'bcc']).optional().default('to'),
})

export const messageObjectSchema = z.object({
  entityModule: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  actionRequired: z.boolean().optional().default(false),
  actionType: z.string().optional(),
  actionLabel: z.string().optional(),
})

export const messageActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelKey: z.string().optional(),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost']).optional(),
  icon: z.string().optional(),
  commandId: z.string().optional(),
  href: z.string().optional(),
  isTerminal: z.boolean().optional(),
  confirmRequired: z.boolean().optional(),
  confirmMessage: z.string().optional(),
})

export const messageActionDataSchema = z.object({
  actions: z.array(messageActionSchema),
  primaryActionId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const composeMessageSchema = z.object({
  type: z.string().optional().default('default'),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().min(1).optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  externalName: z.string().min(1).max(255).optional(),
  recipients: z.array(messageRecipientSchema).max(100).optional().default([]),
  subject: z.string().max(500).optional().default(''),
  body: z.string().max(50000).optional().default(''),
  bodyFormat: z.enum(['text', 'markdown']).optional().default('text'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  objects: z.array(messageObjectSchema).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  attachmentRecordId: z.string().min(1).max(255).optional(),
  actionData: messageActionDataSchema.optional(),
  sendViaEmail: z.boolean().optional().default(false),
  parentMessageId: z.string().uuid().optional(),
  isDraft: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  const isDraft = value.isDraft ?? false
  const visibility = value.visibility ?? 'internal'
  const recipientCount = value.recipients.length
  const hasExternalEmail = Boolean(value.externalEmail?.trim())
  const hasSubject = value.subject.trim().length > 0
  const hasBody = value.body.trim().length > 0

  if (!isDraft) {
    if (visibility === 'public') {
      if (!hasExternalEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['externalEmail'],
          message: 'externalEmail is required when visibility is public',
        })
      }
      if (recipientCount > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipients'],
          message: 'recipients must be empty when visibility is public',
        })
      }
    } else if (recipientCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipients'],
        message: 'at least one recipient is required when visibility is internal',
      })
    }

    if (!hasSubject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject'],
        message: 'subject is required',
      })
    }
    if (!hasBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'body is required',
      })
    }
  }

  const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
  if (duplicateRecipientIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'recipient user ids must be unique',
    })
  }
})

export const updateDraftSchema = z.object({
  type: z.string().optional(),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().min(1).optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  externalName: z.string().min(1).max(255).optional(),
  recipients: z.array(messageRecipientSchema).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50000).optional(),
  bodyFormat: z.enum(['text', 'markdown']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  objects: z.array(messageObjectSchema).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  actionData: messageActionDataSchema.optional(),
  sendViaEmail: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.recipients) return
  const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
  if (duplicateRecipientIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'recipient user ids must be unique',
    })
  }
})

export const listMessagesSchema = z.object({
  folder: z.enum(['inbox', 'sent', 'drafts', 'archived', 'all']).optional().default('inbox'),
  status: z.enum(['unread', 'read', 'archived']).optional(),
  type: z.string().optional(),
  visibility: z.enum(['public', 'internal']).optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  hasObjects: z.coerce.boolean().optional(),
  hasAttachments: z.coerce.boolean().optional(),
  hasActions: z.coerce.boolean().optional(),
  senderId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  since: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const forwardMessageSchema = z.object({
  recipients: z.array(messageRecipientSchema).min(1).max(100),
  additionalBody: z.string().max(10000).optional(),
  includeAttachments: z.boolean().optional().default(true),
  sendViaEmail: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
  if (duplicateRecipientIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'recipient user ids must be unique',
    })
  }
})

export const replyMessageSchema = z.object({
  body: z.string().min(1).max(50000),
  bodyFormat: z.enum(['text', 'markdown']).optional().default('text'),
  recipients: z.array(messageRecipientSchema).max(100).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  attachmentRecordId: z.string().min(1).max(255).optional(),
  replyAll: z.boolean().optional().default(false),
  sendViaEmail: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (!value.recipients) return
  const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
  if (duplicateRecipientIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'recipient user ids must be unique',
    })
  }
})

export const executeActionSchema = z.object({
  messageId: z.string().uuid(),
  actionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const confirmMessageSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  confirmed: z.boolean().optional().default(true),
})

export const messageObjectTypesQuerySchema = z.object({
  messageType: z.string().min(1),
})

export const attachmentIdsPayloadSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).min(1).max(100),
})

export const unlinkAttachmentPayloadSchema = z.object({
  attachmentId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).min(1).max(100).optional(),
}).refine(
  (value) => Boolean(value.attachmentId || value.attachmentIds?.length),
  { message: 'attachmentId or attachmentIds is required' }
)

export type ComposeMessageInput = z.infer<typeof composeMessageSchema>
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>
export type ListMessagesInput = z.infer<typeof listMessagesSchema>
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>
export type ExecuteActionInput = z.infer<typeof executeActionSchema>
export type ConfirmMessageInput = z.infer<typeof confirmMessageSchema>
export type MessageObjectTypesQueryInput = z.infer<typeof messageObjectTypesQuerySchema>
export type AttachmentIdsPayload = z.infer<typeof attachmentIdsPayloadSchema>
export type UnlinkAttachmentPayload = z.infer<typeof unlinkAttachmentPayloadSchema>
