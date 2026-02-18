import { z } from 'zod'
import {
  attachmentIdsPayloadSchema,
  composeMessageSchema,
  executeActionSchema,
  forwardMessageSchema,
  listMessagesSchema,
  messageObjectTypesQuerySchema,
  messageActionDataSchema,
  messageActionSchema,
  messageObjectSchema,
  messageRecipientSchema,
  replyMessageSchema,
  unlinkAttachmentPayloadSchema,
  updateDraftSchema,
} from '../data/validators'

export const messageAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  url: z.string(),
})

export const messageListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  externalEmail: z.string().nullable().optional(),
  externalName: z.string().nullable().optional(),
  subject: z.string(),
  bodyPreview: z.string(),
  senderUserId: z.string().uuid(),
  senderName: z.string().nullable().optional(),
  senderEmail: z.string().nullable().optional(),
  priority: z.string(),
  status: z.string(),
  hasObjects: z.boolean(),
  objectCount: z.number(),
  hasAttachments: z.boolean(),
  attachmentCount: z.number(),
  recipientCount: z.number(),
  hasActions: z.boolean(),
  actionTaken: z.string().nullable().optional(),
  sentAt: z.string().nullable().optional(),
  readAt: z.string().nullable().optional(),
  threadId: z.string().uuid().nullable().optional(),
})

export const messageThreadItemSchema = z.object({
  id: z.string().uuid(),
  senderUserId: z.string().uuid(),
  senderName: z.string().nullable().optional(),
  senderEmail: z.string().nullable().optional(),
  body: z.string(),
  sentAt: z.string().nullable().optional(),
})

export const messageDetailResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  externalEmail: z.string().nullable().optional(),
  externalName: z.string().nullable().optional(),
  typeDefinition: z.object({
    labelKey: z.string(),
    icon: z.string(),
    color: z.string().optional().nullable(),
    allowReply: z.boolean(),
    allowForward: z.boolean(),
    ui: z.object({
      listItemComponent: z.string().nullable().optional(),
      contentComponent: z.string().nullable().optional(),
      actionsComponent: z.string().nullable().optional(),
    }).nullable().optional(),
  }),
  threadId: z.string().uuid().nullable().optional(),
  parentMessageId: z.string().uuid().nullable().optional(),
  senderUserId: z.string().uuid(),
  senderName: z.string().nullable().optional(),
  senderEmail: z.string().nullable().optional(),
  subject: z.string(),
  body: z.string(),
  bodyFormat: z.enum(['text', 'markdown']),
  priority: z.string(),
  sentAt: z.string().nullable().optional(),
  actionData: messageActionDataSchema.optional().nullable(),
  actionTaken: z.string().nullable().optional(),
  actionTakenAt: z.string().nullable().optional(),
  actionTakenByUserId: z.string().uuid().nullable().optional(),
  recipients: z.array(z.object({
    userId: z.string().uuid(),
    type: z.enum(['to', 'cc', 'bcc']),
    status: z.string(),
    readAt: z.string().nullable().optional(),
  })),
  objects: z.array(z.object({
    id: z.string().uuid(),
    entityModule: z.string(),
    entityType: z.string(),
    entityId: z.string().uuid(),
    actionRequired: z.boolean(),
    actionType: z.string().nullable().optional(),
    actionLabel: z.string().nullable().optional(),
    snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    preview: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      status: z.string().optional(),
      statusColor: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }).nullable().optional(),
  })),
  thread: z.array(messageThreadItemSchema),
  isRead: z.boolean(),
})

export const messageTokenResponseSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  body: z.string(),
  bodyFormat: z.enum(['text', 'markdown']),
  senderUserId: z.string().uuid(),
  sentAt: z.string().nullable().optional(),
  objects: z.array(z.object({
    id: z.string().uuid(),
    entityModule: z.string(),
    entityType: z.string(),
    entityId: z.string().uuid(),
    actionRequired: z.boolean(),
    actionType: z.string().nullable().optional(),
    actionLabel: z.string().nullable().optional(),
  })),
  requiresAuth: z.boolean(),
  recipientUserId: z.string().uuid(),
})

export const unreadCountResponseSchema = z.object({
  unreadCount: z.number(),
})

export const messageConfirmationResponseSchema = z.object({
  messageId: z.string().uuid(),
  confirmed: z.boolean(),
  confirmedAt: z.string().nullable(),
  confirmedByUserId: z.string().uuid().nullable(),
})

export const actionResultResponseSchema = z.object({
  ok: z.boolean(),
  actionId: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
})

export const forwardResponseSchema = z.object({
  id: z.string().uuid(),
})

export const composeResponseSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
})

export const messageAttachmentResponseSchema = z.object({
  attachments: z.array(messageAttachmentSchema),
})

export const okResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid().optional(),
  message: z.string().optional(),
})

export const errorResponseSchema = z.object({
  error: z.string(),
})

export const messageTypeResponseItemSchema = z.object({
  type: z.string(),
  module: z.string(),
  labelKey: z.string(),
  icon: z.string(),
  color: z.string().nullable().optional(),
  isCreateableByUser: z.boolean(),
  allowReply: z.boolean(),
  allowForward: z.boolean(),
  actionsExpireAfterHours: z.number().int().nullable().optional(),
  ui: z.object({
    listItemComponent: z.string().nullable().optional(),
    contentComponent: z.string().nullable().optional(),
    actionsComponent: z.string().nullable().optional(),
  }).nullable().optional(),
})

export const messageTypeListResponseSchema = z.object({
  items: z.array(messageTypeResponseItemSchema),
})

export const messageObjectTypeActionResponseSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional(),
  icon: z.string().optional(),
  commandId: z.string().optional(),
  href: z.string().optional(),
  isTerminal: z.boolean().optional(),
  confirmRequired: z.boolean().optional(),
  confirmMessage: z.string().optional(),
})

export const messageObjectTypeResponseItemSchema = z.object({
  module: z.string(),
  entityType: z.string(),
  labelKey: z.string(),
  icon: z.string(),
  actions: z.array(messageObjectTypeActionResponseSchema),
})

export const messageObjectTypeListResponseSchema = z.object({
  items: z.array(messageObjectTypeResponseItemSchema),
})

export {
  messageActionDataSchema,
  messageActionSchema,
  messageObjectSchema,
  messageRecipientSchema,
  composeMessageSchema,
  listMessagesSchema,
  forwardMessageSchema,
  replyMessageSchema,
  updateDraftSchema,
  executeActionSchema,
  messageObjectTypesQuerySchema,
  attachmentIdsPayloadSchema,
  unlinkAttachmentPayloadSchema,
}
