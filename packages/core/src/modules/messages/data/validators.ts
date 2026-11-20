import { z } from 'zod'
import { parseBooleanFlag } from '@open-mercato/shared/lib/boolean'
import { sanitizeRichTextHref } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { channelTypeRequiresExternalEmail } from '../lib/channel-sender-identity'
import { getScheduleMaxDays } from '../lib/scheduleLimits'

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

function validateDefaultWithObjectsPayload(
  value: {
    type?: string
    objects?: Array<{ actionRequired?: boolean; actionType?: string; actionLabel?: string }>
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type !== 'messages.defaultWithObjects') return

  if (!Array.isArray(value.objects) || value.objects.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['objects'],
      message: 'at least one object is required for messages.defaultWithObjects',
    })
    return
  }

  value.objects.forEach((object, index) => {
    if (object.actionRequired === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objects', index, 'actionRequired'],
        message: 'actionRequired must be false for messages.defaultWithObjects',
      })
    }
    if (typeof object.actionType === 'string' && object.actionType.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objects', index, 'actionType'],
        message: 'actionType is not allowed for messages.defaultWithObjects',
      })
    }
    if (typeof object.actionLabel === 'string' && object.actionLabel.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objects', index, 'actionLabel'],
        message: 'actionLabel is not allowed for messages.defaultWithObjects',
      })
    }
  })
}

export const SCHEDULE_ERROR_KEYS = {
  inPast: 'messages.errors.scheduleInPast',
  tooFar: 'messages.errors.scheduleTooFar',
  notMinute: 'messages.errors.scheduleNotMinute',
} as const

const scheduledAtSchema = z.coerce.date()

function refineScheduledAt(
  value: { scheduledAt?: Date | null; isDraft?: boolean },
  ctx: z.RefinementCtx,
): void {
  const scheduledAt = value.scheduledAt
  if (!(scheduledAt instanceof Date)) return
  if (value.isDraft === true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledAt'], message: 'scheduledAt cannot be combined with isDraft' })
    return
  }
  const time = scheduledAt.getTime()
  const now = Date.now()
  if (scheduledAt.getUTCSeconds() !== 0 || scheduledAt.getUTCMilliseconds() !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledAt'], message: SCHEDULE_ERROR_KEYS.notMinute })
  } else if (time <= now) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledAt'], message: SCHEDULE_ERROR_KEYS.inPast })
  } else if (time > now + getScheduleMaxDays() * 86_400_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledAt'], message: SCHEDULE_ERROR_KEYS.tooFar })
  }
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
  href: z
    .string()
    .optional()
    .refine(
      (value) => value == null || sanitizeRichTextHref(value) != null,
      { message: '[internal] message action href must be http(s), mailto, tel, or a relative path' },
    ),
  isTerminal: z.boolean().optional(),
  confirmRequired: z.boolean().optional(),
  confirmMessage: z.string().optional(),
})

export const messageActionDataSchema = z.object({
  actions: z.array(messageActionSchema),
  primaryActionId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const MAX_COMPOSE_EXTERNAL_EMAILS = 50
// Inbound mail may carry long To/CC headers; ingest must never fail on them.
export const MAX_COMPOSE_EXTERNAL_PARTICIPANTS = 500

export const externalParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(['to', 'cc', 'bcc']),
})

const composeMessageBaseSchema = z.object({
  type: z.string().optional().default('default'),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().min(1).optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  externalEmails: z.array(z.string().email()).min(1).max(MAX_COMPOSE_EXTERNAL_EMAILS).optional(),
  /** Deliver one email per external address so recipients do not see each other. */
  sendSeparately: z.boolean().optional(),
  /**
   * Additional external addressees with their role. Server-only: set by
   * channel ingest (extra inbound To/CC) and mailbox sends; the HTTP route
   * strips any client-sent value.
   */
  externalParticipants: z.array(externalParticipantSchema).max(MAX_COMPOSE_EXTERNAL_PARTICIPANTS).optional(),
  externalName: z.string().min(1).max(255).optional(),
  /**
   * Channel type the message originates from, when the caller knows it (#4975).
   * Non-email channels (Discord, Slack, SMS…) have senders with no address, so
   * `externalEmail` is not required for them. Resolved server-side — the HTTP
   * route strips any client-sent value and derives it from the referenced
   * conversation or parent message, so a caller cannot waive the requirement by
   * asserting its own channel type.
   */
  sourceChannelType: z.string().min(1).max(64).optional(),
  /**
   * Set by channel ingest for a message that arrived FROM an external channel
   * (#6093). On such a message `recipients` are not external addressees — a
   * public message has none — but the internal users the hub routes it to
   * (the conversation's assignee), so the "no recipients on a public message"
   * rule does not apply. Server-only like `sourceChannelType`: the HTTP route
   * strips any client-sent value, so a caller cannot waive the rule by
   * asserting its message came in from a channel.
   */
  inboundFromChannel: z.boolean().optional(),
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
  /**
   * Employee-owned communication channel to send this message through instead
   * of the platform sender (#6258). The channel is never trusted from the body:
   * the route hands it to the `communication_channels` send-as-user facade,
   * which resolves it inside the caller's scope and refuses a channel the
   * caller does not own. Absent means the platform sender.
   */
  senderChannelId: z.string().uuid().optional(),
  parentMessageId: z.string().uuid().optional(),
  isDraft: z.boolean().optional().default(false),
  /**
   * When the message was actually sent, if the caller knows better than "now"
   * (#6095). Channel ingest sets it to the provider's timestamp so an imported
   * mailbox keeps its real chronology instead of collapsing onto the import
   * minute. Server-only: the HTTP route strips any client-sent value, so a
   * browser caller cannot backdate a message. Explicit null preserves unknown
   * external occurrence time; omission uses the send time. Ignored for drafts.
   */
  sentAt: z.coerce.date().nullable().optional(),
  /** Send later: the message is stored as a scheduled draft and released at this instant (whole minute, UTC). */
  scheduledAt: scheduledAtSchema.optional(),
})

type ComposeMessageRefinementValue = Omit<
  z.infer<typeof composeMessageBaseSchema>,
  'sourceChannelType' | 'sentAt' | 'externalParticipants'
> & { sourceChannelType?: string; sentAt?: Date | null }

function refineExternalEmailsExclusive(
  value: { externalEmail?: string; externalEmails?: string[] },
  ctx: z.RefinementCtx,
): void {
  if (value.externalEmail !== undefined && value.externalEmails !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['externalEmails'],
      message: 'externalEmails cannot be combined with externalEmail',
    })
  }
}

function refineComposeMessage(value: ComposeMessageRefinementValue, ctx: z.RefinementCtx): void {
  const isDraft = value.isDraft ?? false
  const visibility = value.visibility ?? 'internal'
  const recipientCount = value.recipients.length
  const hasExternalEmail = Boolean(value.externalEmail?.trim()) || (value.externalEmails?.length ?? 0) > 0
  const hasSubject = value.subject.trim().length > 0
  const hasBody = value.body.trim().length > 0

  if (!isDraft) {
    if (visibility === 'public') {
      // #4975: an external correspondent is only guaranteed to have an address
      // on an email-typed channel. `channelTypeRequiresExternalEmail` fails
      // closed, so an unknown or absent channel type keeps the original rule.
      if (!hasExternalEmail && channelTypeRequiresExternalEmail(value.sourceChannelType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['externalEmail'],
          message: 'externalEmail is required when visibility is public',
        })
      }
      // #6093: a channel-ingested message is addressed to the assignee of its
      // conversation; that recipient is internal routing, not a second
      // external addressee, so only a user-composed public message is bound
      // by this rule.
      if (recipientCount > 0 && !value.inboundFromChannel) {
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

  refineExternalEmailsExclusive(value, ctx)

  const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
  if (duplicateRecipientIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'recipient user ids must be unique',
    })
  }

  validateDefaultWithObjectsPayload(value, ctx)
  refineScheduledAt(value, ctx)
}

/**
 * Full compose contract, including the server-resolved `sourceChannelType`,
 * the ingest-only `inboundFromChannel`, and the server-supplied `sentAt`. Used
 * by the `messages.messages.compose` command and by the HTTP route AFTER it
 * has resolved the channel type itself.
 */
export const composeMessageSchema = composeMessageBaseSchema.superRefine(refineComposeMessage)

/**
 * Client-facing compose contract — the same rules minus the server-only fields:
 * `sourceChannelType` is never accepted from a request body (#4975), neither is
 * `inboundFromChannel` (#6093) nor `sentAt` (#6095). Published in OpenAPI so the
 * documented request shape matches what `POST /api/messages` actually reads:
 * the route discards any client-sent value for these, resolves the real
 * channel type from the referenced conversation or parent message, and only
 * then validates against {@link composeMessageSchema}.
 */
export const composeMessageRequestSchema = composeMessageBaseSchema
  .omit({ sourceChannelType: true, inboundFromChannel: true, sentAt: true, externalParticipants: true })
  .superRefine(refineComposeMessage)

export const updateDraftSchema = z.object({
  type: z.string().optional(),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().min(1).optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  /** Replaces the draft's external addressees ("to"). */
  externalEmails: z.array(z.string().email()).min(1).max(MAX_COMPOSE_EXTERNAL_EMAILS).optional(),
  sendSeparately: z.boolean().optional(),
  externalName: z.string().min(1).max(255).optional(),
  recipients: z.array(messageRecipientSchema).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(50000).optional(),
  bodyFormat: z.enum(['text', 'markdown']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  objects: z.array(messageObjectSchema).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  actionData: messageActionDataSchema.optional(),
  sendViaEmail: z.boolean().optional(),
  isDraft: z.literal(false).optional(),
  /** Stored on the draft; sending or releasing it goes through this mailbox (falls back to the stored one when omitted). */
  senderChannelId: z.string().uuid().optional(),
  /** A date (re)schedules the draft; `null` turns a scheduled message back into a plain draft. */
  scheduledAt: scheduledAtSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  refineExternalEmailsExclusive(value, ctx)
  if (value.scheduledAt instanceof Date && value.isDraft === false) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledAt'], message: 'scheduledAt cannot be combined with isDraft false' })
  } else {
    refineScheduledAt(value, ctx)
  }
  if (value.recipients) {
    const duplicateRecipientIds = collectDuplicateRecipientIds(value.recipients)
    if (duplicateRecipientIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipients'],
        message: 'recipient user ids must be unique',
      })
    }
  }

  validateDefaultWithObjectsPayload(value, ctx)
})

export const listMessagesSchema = z.object({
  folder: z.enum(['inbox', 'sent', 'drafts', 'scheduled', 'archived', 'all']).optional().default('inbox'),
  status: z.enum(['unread', 'read', 'archived']).optional(),
  type: z.string().optional(),
  visibility: z.enum(['public', 'internal']).optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
  hasObjects: z.string().transform(parseBooleanFlag).optional(),
  hasAttachments: z.string().transform(parseBooleanFlag).optional(),
  hasActions: z.string().transform(parseBooleanFlag).optional(),
  senderId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  since: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const forwardMessageSchema = z.object({
  recipients: z.array(messageRecipientSchema).max(100),
  externalEmails: z.array(z.string().email()).min(1).max(MAX_COMPOSE_EXTERNAL_EMAILS).optional(),
  sendSeparately: z.boolean().optional(),
  body: z.string().max(50000).optional(),
  additionalBody: z.string().max(10000).optional(),
  includeAttachments: z.boolean().optional().default(true),
  sendViaEmail: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (value.recipients.length === 0 && !value.externalEmails) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recipients'],
      message: 'at least one recipient is required',
    })
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

export const replyMessageSchema = z.object({
  body: z.string().min(1).max(50000),
  bodyFormat: z.enum(['text', 'markdown']).optional().default('text'),
  recipients: z.array(messageRecipientSchema).max(100).optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  attachmentRecordId: z.string().min(1).max(255).optional(),
  replyAll: z.boolean().optional().default(false),
  /** Overrides the inherited external counterpart; reply-all pre-fills it from the source participants. */
  externalEmails: z.array(z.string().email()).min(1).max(MAX_COMPOSE_EXTERNAL_EMAILS).optional(),
  sendSeparately: z.boolean().optional(),
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

export const resendFailedSchema = z.object({
  /** Failed participants to resend to; omitted means every failed participant of the message. */
  participantIds: z.array(z.string().uuid()).min(1).max(MAX_COMPOSE_EXTERNAL_PARTICIPANTS).optional(),
})

export type ComposeMessageInput = z.infer<typeof composeMessageSchema>
export type ResendFailedInput = z.infer<typeof resendFailedSchema>
export type ExternalParticipantInput = z.infer<typeof externalParticipantSchema>
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>
export type ListMessagesInput = z.infer<typeof listMessagesSchema>
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>
export type ExecuteActionInput = z.infer<typeof executeActionSchema>
export type ConfirmMessageInput = z.infer<typeof confirmMessageSchema>
export type MessageObjectTypesQueryInput = z.infer<typeof messageObjectTypesQuerySchema>
export type AttachmentIdsPayload = z.infer<typeof attachmentIdsPayloadSchema>
export type UnlinkAttachmentPayload = z.infer<typeof unlinkAttachmentPayloadSchema>
