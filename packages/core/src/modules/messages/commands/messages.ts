import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Message,
  MessageExternalParticipant,
  MessageObject,
  MessageRecipient,
  type EmailDeliveryRoute,
  type MessageActionData,
} from '../data/entities'
import { emitMessagesEvent } from '../events'
import {
  composeMessageSchema,
  forwardMessageSchema,
  replyMessageSchema,
  resendFailedSchema,
  updateDraftSchema,
} from '../data/validators'
import { conflict, CrudHttpError, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { notificationTypes } from '../notifications'
import { claimDueScheduledMessages, type ClaimedScheduledMessage, type ScheduledReleaseScope } from '../lib/scheduledRelease'
import { MAX_SCHEDULED_RELEASE_ATTEMPTS, RELEASE_SCHEDULED_COMMAND_ID } from '../lib/scheduledSend'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { delegateComposeToSender, handOffMessageToSender } from '../lib/composeSenderDelegation'
import { SEND_AS_USER_SOURCE_ENTITY_TYPE } from '../lib/messageSourceEntityTypes'
import {
  copyAttachmentsForForwardMessages,
  deleteMessageAttachmentRows,
  enqueueMessageAttachmentSectionCleanup,
  linkAttachmentsToMessage,
  linkLibraryAttachmentsToMessage,
  type DeletedMessageAttachmentRows,
} from '../lib/attachments'
import {
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  resolveActorFeatures,
  resolveMessageChannelThreadAccess,
} from '../lib/channelThreadAccess'
import { MESSAGE_ENTITY_ID, SYSTEM_SENDER_USER_ID } from '../lib/constants'
import { canUseChannelThreadFallback } from '../lib/routeHelpers'
import { getMessageTypeOrDefault } from '../lib/message-types-registry'
import { validateMessageObjectsForType } from '../lib/object-validation'
import {
  MAILBOX_UNAVAILABLE_ERROR,
  planComposeExternalParticipants,
  settleExternalParticipants,
  type PlannedExternalParticipant,
} from '../lib/externalParticipants'
import { assertExternalEmailBudget, ExternalEmailBudgetError } from '../lib/externalEmailBudget'
import { buildForwardBodyFromLegacyInput, buildForwardPreviewFromThreadSlice, buildForwardThreadSlice } from '../lib/forwarding'
import {
  assertOrganizationAccess,
  loadMessageAggregateSnapshot,
  restoreMessageAggregateSnapshot,
  type MessageAggregateSnapshot,
  type MessageScopeInput,
} from './shared'

type MessageSentEventPayload = {
  messageId: string
  senderUserId: string
  recipientUserIds: string[]
  sendViaEmail: boolean
  /**
   * The message arrived from an external channel (#6093). Its `senderUserId`
   * is the channel's system user and its real correspondent lives in
   * `externalName` / `externalEmail`; subscribers that show a sender read it
   * from there.
   */
  inboundFromChannel?: boolean
  externalEmail?: string | null
  forwardedFrom?: string
  replyTo?: string
  tenantId: string
  organizationId?: string | null
}

type ContainerWithResolve = {
  resolve: (name: string) => unknown
}

async function emitMessageSentEvent(_container: ContainerWithResolve, payload: MessageSentEventPayload) {
  await emitMessagesEvent('messages.message.sent', payload, { persistent: true })
}

async function emitDraftSentEvent(
  container: ContainerWithResolve,
  message: Message,
  recipientUserIds: string[],
) {
  await emitMessageSentEvent(container, {
    messageId: message.id,
    senderUserId: message.senderUserId,
    recipientUserIds,
    sendViaEmail: draftSendsViaEmail(message),
    externalEmail: message.externalEmail ?? null,
    tenantId: message.tenantId,
    organizationId: message.organizationId ?? null,
  })
}

/**
 * Recorded on the message before its external participants become pending, so
 * the retry tick and the email worker only send platform mail for `system`:
 * a mailbox send, a channel conversation or a message without email delivery
 * is never picked up by the platform sender.
 */
function resolveEmailDeliveryRoute(
  message: Pick<Message, 'externalEmail' | 'senderChannelId' | 'sourceEntityType'>,
  sendViaEmail: boolean,
): EmailDeliveryRoute | null {
  if (message.senderChannelId || message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE) return 'send_as_user'
  if (message.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) return null
  return sendViaEmail && message.externalEmail ? 'system' : null
}

/** A message without email delivery keeps its addressees without status, so the retry tick never fails them. */
function participantsAwaitDelivery(
  message: Pick<Message, 'sourceEntityType'>,
  route: EmailDeliveryRoute | null,
): boolean {
  return route !== null || message.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE
}

function draftSendsViaEmail(message: Pick<Message, 'visibility' | 'sendViaEmail'>): boolean {
  return message.visibility === 'public' ? true : message.sendViaEmail
}

async function markDraftParticipantsPending(
  em: EntityManager,
  scope: { messageId: string; tenantId: string; organizationId: string | null },
) {
  await em.nativeUpdate(MessageExternalParticipant, { ...scope, deliveryStatus: null }, { deliveryStatus: 'pending' })
}

async function emitMessageScheduledEvent(payload: {
  messageId: string
  senderUserId: string
  scheduledAt: Date
  tenantId: string
  organizationId: string | null
}) {
  // The audience is the author only: recipients must not learn about a message before it is released.
  await emitMessagesEvent(
    'messages.message.scheduled',
    { ...payload, scheduledAt: payload.scheduledAt.toISOString(), recipientUserIds: [payload.senderUserId] },
    { persistent: true },
  )
}

async function emitMessageDeletedEvent(_container: ContainerWithResolve, payload: {
  messageId: string
  actorUserId: string
  target: 'sender' | 'recipient'
  tenantId: string
  organizationId: string | null
}) {
  await emitMessagesEvent(
    'messages.message.deleted',
    { ...payload, recipientUserId: payload.actorUserId },
    { persistent: true },
  )
}

async function emitMessageGloballyDeletedEvent(_container: ContainerWithResolve, payload: {
  messageId: string
  actorUserId: string
  recipientUserIds: string[]
  tenantId: string
  organizationId: string | null
}) {
  const audience = Array.from(new Set([payload.actorUserId, ...payload.recipientUserIds]))
  await emitMessagesEvent(
    'messages.message.deleted',
    {
      messageId: payload.messageId,
      actorUserId: payload.actorUserId,
      target: 'global',
      recipientUserIds: audience,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
    { persistent: true },
  )
}

async function emitMessageIndexUpsert(
  container: ContainerWithResolve,
  payload: {
    messageId: string
    tenantId: string
    organizationId: string | null
  },
) {
  let bus: { emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void> } | null = null
  try {
    bus = container.resolve('eventBus') as { emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void> }
  } catch {
    bus = null
  }

  if (!bus) return

  await bus.emitEvent(
    'query_index.upsert_one',
    {
      entityType: MESSAGE_ENTITY_ID,
      recordId: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      crudAction: 'updated',
      coverageBaseDelta: 1,
    },
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
  ).catch(() => undefined)
}

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

const composeCommandSchema = composeMessageSchema.safeExtend({
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
  // Optional dedup key (inbound email ingest sets it; other callers leave it
  // undefined). When set, a re-issued compose returns the first message instead
  // of creating a duplicate.
  idempotencyKey: z.string().min(1).max(255).optional(),
  externalEmailRecipients: z.array(z.string().email()).min(1).optional(),
})

const updateDraftCommandSchema = updateDraftSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const replyCommandSchema = replyMessageSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const forwardCommandSchema = forwardMessageSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const deleteForActorCommandSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

type ComposeCommandInput = z.infer<typeof composeCommandSchema>
type UpdateDraftCommandInput = z.infer<typeof updateDraftCommandSchema>
type ReplyCommandInput = z.infer<typeof replyCommandSchema>
type ForwardCommandInput = z.infer<typeof forwardCommandSchema>
type DeleteForActorCommandInput = z.infer<typeof deleteForActorCommandSchema>

type MessageDeleteUndoState = {
  messageId: string
  messageDeletedAt: string | null
  recipientId: string | null
  recipientStatus: 'unread' | 'read' | 'archived' | 'deleted' | null
  recipientDeletedAt: string | null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

function buildReplySubject(subject: string): string {
  if (/^re:\s*/i.test(subject)) return subject
  return `Re: ${subject}`
}

async function requireMessageById(
  em: EntityManager,
  scope: MessageScopeInput,
  messageId: string,
) {
  const message = await findOneWithDecryption(
    em,
    Message,
    {
      id: messageId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
  )
  if (!message) throw new Error('Message not found')
  assertOrganizationAccess(scope, message)
  return message
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === '23505') return true
  const message = (err as { message?: string }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}

type ComposeMessageResult = {
  id: string
  threadId: string | null
  externalEmail: string | null
  isDraft: boolean
  recipientUserIds: string[]
  /**
   * True when this was an idempotent replay — an existing message was returned
   * and nothing was written. Signals `buildLog` to skip the audit/undo entry.
   */
  deduplicated?: boolean
}

async function buildComposeResultFromExisting(
  em: EntityManager,
  message: Message,
): Promise<ComposeMessageResult> {
  const recipients = await findWithDecryption(
    em,
    MessageRecipient,
    { messageId: message.id, deletedAt: null },
    undefined,
    { tenantId: message.tenantId, organizationId: message.organizationId ?? null },
  )
  return {
    id: message.id,
    threadId: message.threadId ?? null,
    externalEmail: message.externalEmail ?? null,
    isDraft: message.isDraft,
    recipientUserIds: recipients.map((recipient) => recipient.recipientUserId),
    deduplicated: true,
  }
}

function persistExternalParticipants(
  em: EntityManager,
  messageId: string,
  participants: PlannedExternalParticipant[],
  scope: { tenantId: string; organizationId?: string | null },
  awaitsDelivery = true,
): void {
  for (const participant of participants) {
    em.persist(em.create(MessageExternalParticipant, {
      messageId,
      role: participant.role,
      email: participant.email,
      emailHash: participant.emailHash,
      name: participant.name,
      deliveryStatus: awaitsDelivery ? participant.deliveryStatus : null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
    }))
  }
}

/**
 * `parentMessageId` is trusted: the thread is derived from it without a read
 * check, because the acting `userId` is itself an input and server-side callers
 * (channel ingest) pass parents the actor is not a participant of. Every surface
 * that accepts a parent from a caller MUST resolve it against its own read rule
 * first (`resolveReplyParentMessage` for the messages API).
 */
const composeMessageCommand: CommandHandler<unknown, { id: string; threadId: string | null; externalEmail: string | null; isDraft: boolean; recipientUserIds: string[]; deduplicated?: boolean }> = {
  id: 'messages.messages.compose',
  async execute(rawInput, ctx) {
    const input = composeCommandSchema.parse(rawInput)
    if (input.objects?.length) {
      const objectValidationError = validateMessageObjectsForType(input.type, input.objects)
      if (objectValidationError) throw new Error(objectValidationError)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    // Idempotency fast-path: a retried inbound-email ingest re-issues compose
    // for the same source message (the first attempt committed the message but a
    // downstream transient failure rolled the ingest back). Return that message
    // so the retry cannot create a duplicate.
    if (input.idempotencyKey) {
      const existing = await findOneWithDecryption(
        em,
        Message,
        { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
        undefined,
        scope,
      )
      if (existing) return buildComposeResultFromExisting(em, existing)
    }

    const scheduledAt = input.scheduledAt ?? null
    if (scheduledAt) assertSchedulingScope(input.organizationId)
    // A scheduled message stays a draft until the release worker sends it, so every draft-hiding read path hides it too.
    const storesAsDraft = input.isDraft || scheduledAt !== null
    const externalAddressing = planComposeExternalParticipants({ ...input, isDraft: storesAsDraft })

    // Every external addressee (all "to", cc and bcc participants) counts against the budget. A scheduled message is charged at release instead.
    if (!input.isDraft && scheduledAt === null && (input.sendViaEmail || input.externalEmailRecipients?.length) && externalAddressing.externalEmail) {
      const participantEmails = externalAddressing.participants.map((participant) => participant.email)
      await assertExternalEmailBudget(
        ctx.container,
        { tenantId: input.tenantId, userId: input.userId },
        input.externalEmailRecipients
          ? [externalAddressing.externalEmail, ...input.externalEmailRecipients]
          : participantEmails.length > 1 ? participantEmails : externalAddressing.externalEmail,
      )
    }

    let messageId = ''
    let responseThreadId: string | null = null
    let responseExternalEmail: string | null = null

    const composeTx = em.transactional(async (trx) => {
      const threadId = input.parentMessageId
        ? (
          await findOneWithDecryption(
            trx,
            Message,
            {
              id: input.parentMessageId,
              tenantId: input.tenantId,
              organizationId: input.organizationId,
              deletedAt: null,
            },
            undefined,
            scope,
          )
        )?.threadId ?? input.parentMessageId
        : undefined

      // Honor the caller's explicit `sendViaEmail` (#6089, #6090). The messages API
      // route forces email delivery for public messages a user composes; internal
      // callers (communication_channels inbound ingest, send-as-user) compose
      // `visibility: 'public'` with `sendViaEmail: false` on purpose. Forcing it
      // here echoed every inbound email back to its sender through the tenant
      // system email channel and made send-as-user deliver twice.
      const sendViaEmail = input.sendViaEmail
      const sentAt = input.sentAt === undefined ? new Date() : input.sentAt
      const message = trx.create(Message, {
        type: input.type,
        visibility: input.visibility ?? null,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        externalEmail: externalAddressing.externalEmail,
        externalName: input.externalName,
        emailSendSeparately: input.sendSeparately ?? false,
        threadId: threadId ?? undefined,
        parentMessageId: input.parentMessageId,
        senderUserId: input.userId,
        subject: input.subject,
        body: input.body,
        bodyFormat: input.bodyFormat,
        priority: input.priority,
        status: scheduledAt ? 'scheduled' : input.isDraft ? 'draft' : 'sent',
        isDraft: storesAsDraft,
        // #6095: channel ingest passes the provider's timestamp so an imported
        // mailbox sorts by when the mail was received, not when it was imported.
        sentAt: storesAsDraft ? null : sentAt,
        scheduledAt,
        // Only a stored message keeps its mailbox; an immediate mailbox send is delegated before reaching this command.
        senderChannelId: storesAsDraft ? input.senderChannelId ?? null : null,
        senderDeliveryOptions: storesAsDraft ? input.senderDeliveryOptions ?? null : null,
        actionData: input.actionData as MessageActionData | undefined,
        sendViaEmail,
        idempotencyKey: input.idempotencyKey ?? null,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      if (!storesAsDraft) message.emailDeliveryRoute = resolveEmailDeliveryRoute(message, sendViaEmail)

      await trx.persist(message).flush()
      if (!threadId && !storesAsDraft && !message.threadId) {
        message.threadId = message.id
        await trx.flush()
      }

      for (const recipient of input.recipients) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: message.id,
          recipientUserId: recipient.userId,
          recipientType: recipient.type,
          status: 'unread',
        }))
      }

      if (input.objects) {
        for (const obj of input.objects) {
          trx.persist(trx.create(MessageObject, {
            messageId: message.id,
            entityModule: obj.entityModule,
            entityType: obj.entityType,
            entityId: obj.entityId,
            actionRequired: obj.actionRequired,
            actionType: obj.actionType,
            actionLabel: obj.actionLabel,
          }))
        }
      }

      persistExternalParticipants(
        trx,
        message.id,
        externalAddressing.participants,
        input,
        storesAsDraft || participantsAwaitDelivery(message, message.emailDeliveryRoute ?? null),
      )

      await trx.flush()

      if (input.attachmentIds?.length) {
        await linkAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentIds,
          input.organizationId,
          input.tenantId,
        )
      }

      if (input.attachmentRecordId) {
        await linkLibraryAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentRecordId,
          input.organizationId,
          input.tenantId,
        )
      }

      messageId = message.id
      responseThreadId = message.threadId ?? null
      responseExternalEmail = message.externalEmail ?? null
    })
    try {
      await composeTx
    } catch (err) {
      // Lost a concurrent race on the same idempotency key — return the message
      // the winning compose created. A propagated 23505 would otherwise be
      // classified permanent and dead-letter the inbound mail.
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await findOneWithDecryption(
          em.fork(),
          Message,
          { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
          undefined,
          scope,
        )
        if (existing) return buildComposeResultFromExisting(em.fork(), existing)
      }
      throw err
    }

    if (scheduledAt) {
      await emitMessageScheduledEvent({
        messageId,
        senderUserId: input.userId,
        scheduledAt,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
    } else if (!input.isDraft) {
      await emitMessageSentEvent(ctx.container, {
        messageId,
        senderUserId: input.userId,
        recipientUserIds: input.recipients.map((recipient) => recipient.userId),
        sendViaEmail: input.sendViaEmail,
        inboundFromChannel: input.inboundFromChannel === true,
        externalEmail: responseExternalEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
    }

    await emitMessageIndexUpsert(ctx.container, {
      messageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      id: messageId,
      threadId: responseThreadId,
      externalEmail: responseExternalEmail,
      isDraft: storesAsDraft,
      recipientUserIds: input.recipients.map((recipient) => recipient.userId),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    // Idempotent replay: execute returned a pre-existing message without writing
    // anything. Skip the audit entry entirely — logging it as a fresh "Compose
    // message" would both misrepresent the dedup and expose an undo that
    // soft-deletes a legitimately-received inbound message.
    if (result.deduplicated) return { skipLog: true }
    const parsed = composeCommandSchema.parse(input)
    return {
      actionLabel: parsed.scheduledAt ? 'Schedule message' : parsed.isDraft ? 'Create draft message' : 'Compose message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
    if (!after.message.isDraft) {
      await emitMessageGloballyDeletedEvent(ctx.container, {
        messageId: after.message.id,
        actorUserId: after.message.senderUserId,
        recipientUserIds: after.recipients.map((recipient) => recipient.recipientUserId),
        tenantId: after.message.tenantId,
        organizationId: after.message.organizationId,
      })
    }
  },
}

/**
 * The draft is already flipped to `sent`; hand it to the author's mailbox before
 * `messages.message.sent` goes out. A refusal puts the draft back as it was.
 */
async function sendDraftThroughMailbox(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  message: Message,
  senderChannelId: string,
  previous: { status: Message['status']; scheduledAt: Date | null },
): Promise<void> {
  const scope = { tenantId: message.tenantId, organizationId: message.organizationId ?? null }
  const restoreDraft = () => em.fork().transactional(async (trx) => {
    await trx.nativeUpdate(
      MessageExternalParticipant,
      { messageId: message.id, ...scope, deliveryStatus: 'pending' },
      { deliveryStatus: null },
    )
    await trx.nativeUpdate(
      Message,
      { id: message.id, ...scope },
      { status: previous.status, isDraft: true, sentAt: null, scheduledAt: previous.scheduledAt, emailDeliveryRoute: null },
    )
  })
  let result: Awaited<ReturnType<typeof handOffMessageToSender>>
  try {
    result = await handOffMessageToSender(
      ctx.container,
      { userId: message.senderUserId, ...scope, auth: ctx.auth ?? null },
      { senderChannelId, messageId: message.id },
    )
  } catch (error) {
    await restoreDraft()
    throw error
  }
  if (result.ok || result.code === 'already_linked') return
  await restoreDraft()
  throw new CrudHttpError(result.status, { error: result.error, fieldErrors: result.fieldErrors })
}

const DRAFT_NOT_EDITABLE_ERROR = 'Only draft messages can be edited'
const SCHEDULING_UNAVAILABLE_ERROR = 'messages.errors.schedulingUnavailable'

/** The release tick runs per organization, so an organization-less message could never be released. */
function assertSchedulingScope(organizationId: string | null | undefined): void {
  if (organizationId) return
  throw new CrudHttpError(422, { error: SCHEDULING_UNAVAILABLE_ERROR, fieldErrors: { scheduledAt: SCHEDULING_UNAVAILABLE_ERROR } })
}

function isEditableDraft(message: Pick<Message, 'isDraft' | 'status'>): boolean {
  return message.isDraft && (message.status === 'draft' || message.status === 'scheduled')
}

const updateDraftCommand: CommandHandler<unknown, { ok: true; id: string }> = {
  id: 'messages.messages.update_draft',
  async prepare(rawInput, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadMessageAggregateSnapshot(em, input.messageId, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireMessageById(em, input, input.messageId)

    if (message.senderUserId !== input.userId) throw new Error('Access denied')
    if (!isEditableDraft(message)) throw new Error(DRAFT_NOT_EDITABLE_ERROR)

    const isSending = input.isDraft === false
    const isScheduling = input.scheduledAt instanceof Date
    if (isScheduling) assertSchedulingScope(message.organizationId)
    const isUnscheduling = input.scheduledAt === null && message.status === 'scheduled'
    const senderChannelId = input.senderChannelId ?? message.senderChannelId ?? null
    const statusBeforeSend = { status: message.status, scheduledAt: message.scheduledAt ?? null }
    const preloadedRecipients = (isSending || isScheduling) && !input.recipients
      ? await findWithDecryption(
        em,
        MessageRecipient,
        { messageId: message.id, deletedAt: null },
        undefined,
        {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        },
      )
      : null

    const nextMessageType = input.type ?? message.type
    if (input.objects) {
      const objectValidationError = validateMessageObjectsForType(nextMessageType, input.objects)
      if (objectValidationError) throw new Error(objectValidationError)
    } else if (input.type !== undefined) {
      const existingObjects = await em.find(MessageObject, { messageId: message.id })
      if (existingObjects.length > 0) {
        const objectValidationError = validateMessageObjectsForType(
          nextMessageType,
          existingObjects.map((item) => ({
            entityModule: item.entityModule,
            entityType: item.entityType,
            entityId: item.entityId,
          })),
        )
        if (objectValidationError) throw new Error(objectValidationError)
      }
    }

    const draftAddressing = input.externalEmails !== undefined || input.externalEmail !== undefined
      ? planComposeExternalParticipants({ externalEmail: input.externalEmail, externalEmails: input.externalEmails, isDraft: true })
      : null

    const finalVisibility = input.visibility ?? message.visibility
    // Validate the send transition BEFORE the atomic-flush block so a rejected
    // send never mutates or flushes anything (everything checked here is known
    // from the parsed input + the loaded message).
    if (isSending || isScheduling) {
      const finalSubject = input.subject ?? message.subject
      const finalBody = input.body ?? message.body
      const finalRecipientCount = input.recipients
        ? input.recipients.length
        : (preloadedRecipients?.length ?? 0)
      if (finalVisibility !== 'public' && finalRecipientCount === 0) {
        throw new Error('at least one recipient is required')
      }
      if (!finalSubject?.trim()) throw new Error('subject is required')
      if (!finalBody?.trim()) throw new Error('body is required')
    }

    const finalSendViaEmail = input.sendViaEmail ?? message.sendViaEmail
    const finalExternalEmail = draftAddressing ? draftAddressing.externalEmail : message.externalEmail
    if (isSending && !isScheduling && (finalVisibility === 'public' || finalSendViaEmail) && finalExternalEmail) {
      // Every external addressee of the draft (all "to", cc and bcc participants) counts against the budget; scheduling is charged at release.
      const stored = await findWithDecryption(
        em,
        MessageExternalParticipant,
        { messageId: message.id, tenantId: input.tenantId, organizationId: input.organizationId },
        undefined,
        { tenantId: input.tenantId, organizationId: input.organizationId },
      )
      const participants = draftAddressing
        ? [...draftAddressing.participants, ...stored.filter((participant) => participant.role !== 'to')]
        : stored
      const participantEmails = (participants ?? []).map((participant) => participant.email).filter(Boolean)
      await assertExternalEmailBudget(
        ctx.container,
        { tenantId: input.tenantId, userId: input.userId },
        participantEmails.length > 1 ? participantEmails : finalExternalEmail,
      )
    }

    let deletedAttachments: DeletedMessageAttachmentRows | null = null
    // Phase 1 mutates the managed `message` scalars; the per-phase flush issues
    // those changes before phase 2's interleaved reads run (e.g.
    // `linkAttachmentsToMessage` issues an `em.find`). Under MikroORM v7 a read
    // between a scalar mutation and the terminal flush on the same EntityManager
    // silently drops the pending changeset, so keeping the scalar edits in their
    // own phase guarantees subject/body/etc. are persisted (SPEC-018 Problem 1).
    await withAtomicFlush(em, [async () => {
      // Contends with the release claim (`FOR UPDATE SKIP LOCKED`) on the same row, so an
      // edit and a release never both win: whichever locks first decides the state.
      const locked = await findOneWithDecryption(
        em,
        Message,
        { id: message.id, tenantId: input.tenantId, organizationId: input.organizationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        { tenantId: input.tenantId, organizationId: input.organizationId },
      )
      if (!locked || !isEditableDraft(locked)) throw new Error(DRAFT_NOT_EDITABLE_ERROR)
      if (input.type !== undefined) message.type = input.type
      if (input.visibility !== undefined) message.visibility = input.visibility
      if (input.sourceEntityType !== undefined) message.sourceEntityType = input.sourceEntityType
      if (input.sourceEntityId !== undefined) message.sourceEntityId = input.sourceEntityId
      if (draftAddressing) message.externalEmail = draftAddressing.externalEmail
      if (input.sendSeparately !== undefined) message.emailSendSeparately = input.sendSeparately
      if (input.externalName !== undefined) message.externalName = input.externalName
      if (input.subject !== undefined) message.subject = input.subject
      if (input.body !== undefined) message.body = input.body
      if (input.bodyFormat !== undefined) message.bodyFormat = input.bodyFormat
      if (input.priority !== undefined) message.priority = input.priority
      if (input.actionData !== undefined) message.actionData = input.actionData
      if (input.sendViaEmail !== undefined) message.sendViaEmail = input.sendViaEmail
      if (input.senderChannelId !== undefined) message.senderChannelId = input.senderChannelId
    }, async () => {
      const participantScope = { messageId: message.id, tenantId: input.tenantId, organizationId: input.organizationId }
      if (draftAddressing) {
        // The draft editor addresses only "to"; copies set by a mailbox or CRM send are kept.
        await em.nativeDelete(MessageExternalParticipant, { ...participantScope, role: 'to' })
        persistExternalParticipants(em, message.id, draftAddressing.participants, input)
        await em.flush()
      }
      if (isSending && participantsAwaitDelivery(message, resolveEmailDeliveryRoute(message, draftSendsViaEmail(message)))) {
        await markDraftParticipantsPending(em, participantScope)
      }

      if (input.recipients) {
        await em.nativeDelete(MessageRecipient, { messageId: message.id })
        for (const recipient of input.recipients) {
          em.persist(em.create(MessageRecipient, {
            messageId: message.id,
            recipientUserId: recipient.userId,
            recipientType: recipient.type,
            status: 'unread',
          }))
        }
      }

      if (input.objects) {
        await em.nativeDelete(MessageObject, { messageId: message.id })
        for (const object of input.objects) {
          em.persist(em.create(MessageObject, {
            messageId: message.id,
            entityModule: object.entityModule,
            entityType: object.entityType,
            entityId: object.entityId,
            actionRequired: object.actionRequired,
            actionType: object.actionType,
            actionLabel: object.actionLabel,
          }))
        }
      }

      if (input.attachmentIds) {
        deletedAttachments = await deleteMessageAttachmentRows(em, {
          messageId: message.id,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          excludeIds: input.attachmentIds,
        })
        await linkAttachmentsToMessage(
          em,
          message.id,
          input.attachmentIds,
          input.organizationId,
          input.tenantId,
        )
      }

      if (isSending) {
        // Send transition was validated before the block; just apply the
        // status mutations here (persisted by this phase's boundary flush).
        message.isDraft = false
        message.status = 'sent'
        message.sentAt = new Date()
        message.scheduledAt = null
        message.emailDeliveryRoute = resolveEmailDeliveryRoute(message, draftSendsViaEmail(message))
        if (!message.threadId) message.threadId = message.id
      } else if (input.scheduledAt instanceof Date) {
        message.status = 'scheduled'
        message.scheduledAt = input.scheduledAt
        message.scheduledReleaseAttempts = 0
      } else if (isUnscheduling) {
        message.status = 'draft'
        message.scheduledAt = null
        message.scheduledReleaseAttempts = 0
      }
    }], { transaction: true })
    if (deletedAttachments) await enqueueMessageAttachmentSectionCleanup(deletedAttachments)

    if (isSending && senderChannelId) {
      await sendDraftThroughMailbox(ctx, em, message, senderChannelId, statusBeforeSend)
    }

    await emitMessageIndexUpsert(ctx.container, {
      messageId: message.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    if (isSending) {
      const recipientUserIds = input.recipients
        ? input.recipients.map((r) => r.userId)
        : (preloadedRecipients ?? []).map((r) => r.recipientUserId)
      await emitDraftSentEvent(ctx.container, message, recipientUserIds)
    } else if (input.scheduledAt instanceof Date) {
      await emitMessageScheduledEvent({
        messageId: message.id,
        senderUserId: message.senderUserId,
        scheduledAt: input.scheduledAt,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
    }

    return { ok: true, id: message.id }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, input.messageId, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = updateDraftCommandSchema.parse(input)
    return {
      actionLabel: parsed.isDraft === false
        ? 'Send draft message'
        : parsed.scheduledAt
          ? 'Schedule draft message'
          : parsed.scheduledAt === null ? 'Cancel scheduled message' : 'Update draft message',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as MessageAggregateSnapshot | undefined) ?? null,
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreMessageAggregateSnapshot(em, before)
  },
}

/**
 * The channel-thread fallback for a non-participant acting on `original`
 * (#5535): the channels hub decides whether the caller may work the thread.
 * An internal thread resolves to `null` and denies, leaving the participant
 * rule in force. Only an explicitly public message qualifies — channel access
 * never opens another operator's internal note, matching the detail read.
 *
 * The same `messages.view` gate as the read routes applies, because the hub
 * grants every shared channel regardless of features: without it, a caller
 * holding only `messages.compose` could forward a conversation it may not read
 * to itself and read it as the recipient.
 */
async function canActOnChannelThreadMessage(
  ctx: CommandRuntimeContext,
  input: { tenantId: string; organizationId?: string | null; userId: string },
  original: Message,
): Promise<boolean> {
  if (original.visibility !== 'public') return false
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId ?? null, userId: input.userId }
  if (!(await canUseChannelThreadFallback(ctx, scope))) return false
  const channelThread = await resolveMessageChannelThreadAccess(
    ctx.container,
    { tenantId: input.tenantId, organizationId: input.organizationId ?? null },
    { messageThreadId: original.threadId ?? original.id },
    { userId: input.userId, features: resolveActorFeatures(ctx.auth) },
  )
  return channelThread?.canAccess === true
}

async function isOnChannelThread(
  ctx: CommandRuntimeContext,
  input: { tenantId: string; organizationId?: string | null; userId: string },
  original: Message,
): Promise<boolean> {
  if (original.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) return true
  const channelThread = await resolveMessageChannelThreadAccess(
    ctx.container,
    { tenantId: input.tenantId, organizationId: input.organizationId ?? null },
    { messageThreadId: original.threadId ?? original.id },
    { userId: input.userId, features: resolveActorFeatures(ctx.auth) },
  )
  return channelThread !== null
}

const replyMessageCommand: CommandHandler<unknown, { id: string; externalEmail: string | null; recipientUserIds: string[] }> = {
  id: 'messages.messages.reply',
  async execute(rawInput, ctx) {
    const input = replyCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const original = await requireMessageById(em, input, input.messageId)
    // Drafts and scheduled messages are not delivered yet, so there is nothing to answer.
    if (original.isDraft) throw new Error('Message not found')
    const ownRecipient = await em.findOne(MessageRecipient, {
      messageId: original.id,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    if (original.senderUserId !== input.userId && !ownRecipient) {
      // A message that arrived over a communication channel has no platform
      // participant to match: its sender is the channel system user and an
      // unassigned conversation produces no recipient rows, so the
      // sender-or-recipient test denies every operator — a tenant admin
      // included (#5535). For a thread the channels hub owns, that hub's own
      // access rule is the applicable one; an internal thread resolves to
      // `null` here and keeps the participant rule unchanged.
      if (!(await canActOnChannelThreadMessage(ctx, input, original))) throw new Error('Access denied')
    }

    const messageType = getMessageTypeOrDefault(original.type)
    if (messageType.allowReply === false) throw new Error('Reply is not allowed for this message type')

    const isReplyRecipient = (userId: string) => userId !== input.userId && userId !== SYSTEM_SENDER_USER_ID
    const recipientIds = new Set(
      (input.recipients ?? [])
        .map((recipient) => recipient.userId)
        .filter(isReplyRecipient),
    )

    if (recipientIds.size === 0) {
      const originalRecipients = await em.find(MessageRecipient, { messageId: original.id, deletedAt: null })
      if (input.replyAll) {
        if (isReplyRecipient(original.senderUserId)) recipientIds.add(original.senderUserId)
        for (const recipient of originalRecipients) {
          if (isReplyRecipient(recipient.recipientUserId)) recipientIds.add(recipient.recipientUserId)
        }
      } else if (original.senderUserId !== input.userId) {
        if (isReplyRecipient(original.senderUserId)) recipientIds.add(original.senderUserId)
      } else {
        for (const recipient of originalRecipients) {
          if (isReplyRecipient(recipient.recipientUserId)) {
            recipientIds.add(recipient.recipientUserId)
            break
          }
        }
      }

      if (recipientIds.size === 0 && original.senderUserId === input.userId) {
        recipientIds.add(input.userId)
      }
    }
    if (recipientIds.size === 0 && original.senderUserId !== SYSTEM_SENDER_USER_ID) {
      throw new Error('No recipients available for reply')
    }

    const replyAddressing = input.externalEmails
      ? planComposeExternalParticipants({ externalEmails: input.externalEmails })
      : null
    const replyExternalEmails: string | string[] = replyAddressing
      ? replyAddressing.participants.map((participant) => participant.email)
      : original.externalEmail ?? []
    const channelThread = !input.sendViaEmail && original.visibility === 'public'
      ? await resolveMessageChannelThreadAccess(
        ctx.container,
        { tenantId: input.tenantId, organizationId: input.organizationId ?? null },
        { messageThreadId: original.threadId ?? original.id },
        { userId: input.userId, features: resolveActorFeatures(ctx.auth) },
      )
      : null
    const sendsChannelEmail = channelThread?.channelType === 'email'
    if ((input.sendViaEmail && replyExternalEmails.length > 0) || sendsChannelEmail) {
      await assertExternalEmailBudget(
        ctx.container,
        { tenantId: input.tenantId, userId: input.userId },
        replyExternalEmails,
      )
    }

    let messageId = ''
    let responseExternalEmail: string | null = null
    await em.transactional(async (trx) => {
      const message = trx.create(Message, {
        type: original.type,
        visibility: original.visibility ?? null,
        sourceEntityType: original.sourceEntityType,
        sourceEntityId: original.sourceEntityId,
        externalEmail: replyAddressing ? replyAddressing.externalEmail : original.externalEmail,
        externalName: replyAddressing ? null : original.externalName,
        emailSendSeparately: replyAddressing ? input.sendSeparately ?? false : false,
        threadId: original.threadId ?? original.id,
        parentMessageId: original.id,
        senderUserId: input.userId,
        subject: buildReplySubject(original.subject),
        body: input.body,
        bodyFormat: input.bodyFormat,
        priority: original.priority,
        status: 'sent',
        isDraft: false,
        sentAt: new Date(),
        sendViaEmail: input.sendViaEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      message.emailDeliveryRoute = resolveEmailDeliveryRoute(message, input.sendViaEmail)
      await trx.persist(message).flush()
      if (replyAddressing) {
        persistExternalParticipants(trx, message.id, replyAddressing.participants, input, participantsAwaitDelivery(message, message.emailDeliveryRoute ?? null))
      }
      for (const recipientUserId of recipientIds) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: message.id,
          recipientUserId,
          recipientType: 'to',
          status: 'unread',
        }))
      }
      await trx.flush()
      if (input.attachmentIds?.length) {
        await linkAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentIds,
          input.organizationId,
          input.tenantId,
        )
      }
      if (input.attachmentRecordId) {
        await linkLibraryAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentRecordId,
          input.organizationId,
          input.tenantId,
        )
      }
      messageId = message.id
      responseExternalEmail = message.externalEmail ?? null
    })

    await emitMessageSentEvent(ctx.container, {
      messageId,
      senderUserId: input.userId,
      recipientUserIds: Array.from(recipientIds),
      sendViaEmail: input.sendViaEmail,
      externalEmail: responseExternalEmail,
      replyTo: original.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    await emitMessageIndexUpsert(ctx.container, {
      messageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      id: messageId,
      externalEmail: responseExternalEmail,
      recipientUserIds: Array.from(recipientIds),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = replyCommandSchema.parse(input)
    return {
      actionLabel: 'Reply to message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      parentResourceKind: 'messages.message',
      parentResourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
    await emitMessageGloballyDeletedEvent(ctx.container, {
      messageId: after.message.id,
      actorUserId: after.message.senderUserId,
      recipientUserIds: after.recipients.map((recipient) => recipient.recipientUserId),
      tenantId: after.message.tenantId,
      organizationId: after.message.organizationId,
    })
  },
}

const forwardMessageCommand: CommandHandler<unknown, { id: string; externalEmail: string | null; recipientUserIds: string[] }> = {
  id: 'messages.messages.forward',
  async execute(rawInput, ctx) {
    const input = forwardCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const original = await requireMessageById(em, input, input.messageId)
    if (original.isDraft) throw new Error('Message not found')
    const isRecipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    // Same fallback as the reply command (#6355): an operator who may answer an
    // inbound channel message may also forward it internally.
    const viaChannelThread = original.senderUserId !== input.userId && !isRecipient
    if (viaChannelThread && !(await canActOnChannelThreadMessage(ctx, input, original))) {
      throw new Error('Access denied')
    }

    const messageType = getMessageTypeOrDefault(original.type)
    if (messageType.allowForward === false) throw new Error('Forward is not allowed for this message type')

    const originalObjects = await em.find(MessageObject, { messageId: input.messageId })
    const forwardThreadSlice = await buildForwardThreadSlice(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.userId,
    }, original, { includePublicThreadMessages: viaChannelThread })
    const generatedPreview = await buildForwardPreviewFromThreadSlice(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.userId,
    }, original, forwardThreadSlice)
    const forwardedBody = typeof input.body === 'string'
      ? input.body
      : buildForwardBodyFromLegacyInput(generatedPreview.body, input.additionalBody)
    // A forward of a channel conversation is addressed to colleagues, never to
    // the correspondent. The channels bridge already refuses `forwardedFrom`, but
    // the messages email path would still mail `externalEmail` on
    // `sendViaEmail` — so the customer's address is not carried onto it.
    // It is also filed as internal: replies copy their parent's visibility and
    // carry no `forwardedFrom`, so a public forward made every reply under it
    // deliverable to the correspondent (#6431, #6428). The bridge routes on the
    // thread, not the source, and some public messages on a channel thread
    // carry no source type (an AI or parented compose), so the thread decides.
    const keepsExternalCorrespondent = !(await isOnChannelThread(ctx, input, original))
    const forwardAddressing = input.externalEmails
      ? planComposeExternalParticipants({ externalEmails: input.externalEmails })
      : null
    const forwardExternalEmails: string | string[] = forwardAddressing
      ? forwardAddressing.participants.map((participant) => participant.email)
      : keepsExternalCorrespondent && original.externalEmail ? original.externalEmail : []
    if (input.sendViaEmail && forwardExternalEmails.length > 0) {
      await assertExternalEmailBudget(
        ctx.container,
        { tenantId: input.tenantId, userId: input.userId },
        forwardExternalEmails,
      )
    }
    let newMessageId = ''
    let responseExternalEmail: string | null = null
    await em.transactional(async (trx) => {
      const newMessage = trx.create(Message, {
        type: original.type,
        visibility: keepsExternalCorrespondent ? original.visibility ?? null : 'internal',
        sourceEntityType: original.sourceEntityType,
        sourceEntityId: original.sourceEntityId,
        externalEmail: forwardAddressing
          ? forwardAddressing.externalEmail
          : keepsExternalCorrespondent ? original.externalEmail : null,
        externalName: !forwardAddressing && keepsExternalCorrespondent ? original.externalName : null,
        emailSendSeparately: forwardAddressing ? input.sendSeparately ?? false : false,
        threadId: original.threadId ?? original.id,
        parentMessageId: original.id,
        senderUserId: input.userId,
        subject: `Fwd: ${original.subject}`,
        body: forwardedBody,
        bodyFormat: original.bodyFormat,
        priority: original.priority,
        status: 'sent',
        isDraft: false,
        sentAt: new Date(),
        sendViaEmail: input.sendViaEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      newMessage.emailDeliveryRoute = resolveEmailDeliveryRoute(newMessage, input.sendViaEmail)
      await trx.persist(newMessage).flush()
      if (forwardAddressing) {
        persistExternalParticipants(trx, newMessage.id, forwardAddressing.participants, input, participantsAwaitDelivery(newMessage, newMessage.emailDeliveryRoute ?? null))
      }
      for (const recipient of input.recipients) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: newMessage.id,
          recipientUserId: recipient.userId,
          recipientType: recipient.type,
          status: 'unread',
        }))
      }
      for (const obj of originalObjects) {
        trx.persist(trx.create(MessageObject, {
          messageId: newMessage.id,
          entityModule: obj.entityModule,
          entityType: obj.entityType,
          entityId: obj.entityId,
          actionRequired: obj.actionRequired,
          actionType: obj.actionType,
          actionLabel: obj.actionLabel,
          entitySnapshot: obj.entitySnapshot,
        }))
      }
      await trx.flush()
      if (input.includeAttachments !== false) {
        await copyAttachmentsForForwardMessages(
          trx,
          forwardThreadSlice.map((item) => item.id),
          newMessage.id,
          input.tenantId,
        )
      }
      newMessageId = newMessage.id
      responseExternalEmail = newMessage.externalEmail ?? null
    })

    await emitMessageSentEvent(ctx.container, {
      messageId: newMessageId,
      senderUserId: input.userId,
      recipientUserIds: input.recipients.map((item) => item.userId),
      sendViaEmail: input.sendViaEmail,
      externalEmail: responseExternalEmail,
      forwardedFrom: original.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    await emitMessageIndexUpsert(ctx.container, {
      messageId: newMessageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      id: newMessageId,
      externalEmail: responseExternalEmail,
      recipientUserIds: input.recipients.map((item) => item.userId),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = forwardCommandSchema.parse(input)
    return {
      actionLabel: 'Forward message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      parentResourceKind: 'messages.message',
      parentResourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
    await emitMessageGloballyDeletedEvent(ctx.container, {
      messageId: after.message.id,
      actorUserId: after.message.senderUserId,
      recipientUserIds: after.recipients.map((recipient) => recipient.recipientUserId),
      tenantId: after.message.tenantId,
      organizationId: after.message.organizationId,
    })
  },
}

const DELETE_RECIPIENT_CLAIM_ATTEMPTS = 3

async function claimRecipientDelete(
  em: EntityManager,
  messageId: string,
  userId: string,
): Promise<{ id: string; status: MessageRecipient['status'] } | null> {
  for (let attempt = 0; attempt < DELETE_RECIPIENT_CLAIM_ATTEMPTS; attempt += 1) {
    const recipient = await em.findOne(
      MessageRecipient,
      { messageId, recipientUserId: userId, deletedAt: null },
      { refresh: true },
    )
    if (!recipient) return null
    const claimed = { id: recipient.id, status: recipient.status }
    const claimedRows = await em.nativeUpdate(
      MessageRecipient,
      { id: claimed.id, deletedAt: null, status: claimed.status },
      { status: 'deleted', deletedAt: new Date() },
    )
    if (claimedRows > 0) return claimed
  }
  throw new Error('[internal] Message recipient changed concurrently during delete')
}

const deleteForActorCommand: CommandHandler<unknown, { ok: true; executed: MessageDeleteUndoState }> = {
  id: 'messages.messages.delete_for_actor',
  async execute(rawInput, ctx) {
    const input = deleteForActorCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireMessageById(em, input, input.messageId)
    const recipient = await claimRecipientDelete(em, input.messageId, input.userId)
    if (recipient) {
      await emitMessageDeletedEvent(ctx.container, {
        messageId: input.messageId,
        actorUserId: input.userId,
        target: 'recipient',
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      return {
        ok: true,
        executed: {
          messageId: message.id,
          messageDeletedAt: toIso(message.deletedAt),
          recipientId: recipient.id,
          recipientStatus: recipient.status,
          recipientDeletedAt: null,
        },
      }
    }
    if (message.senderUserId === input.userId) {
      const recipientRows = await em.find(MessageRecipient, { messageId: input.messageId })
      const messageDeletedAtBefore = toIso(message.deletedAt)
      message.deletedAt = new Date()
      await em.flush()
      const recipientUserIds = recipientRows
        .map((row) => row.recipientUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      await emitMessageGloballyDeletedEvent(ctx.container, {
        messageId: input.messageId,
        actorUserId: input.userId,
        recipientUserIds,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      return {
        ok: true,
        executed: {
          messageId: message.id,
          messageDeletedAt: messageDeletedAtBefore,
          recipientId: null,
          recipientStatus: null,
          recipientDeletedAt: null,
        },
      }
    }
    throw new Error('Access denied')
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = deleteForActorCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: input.messageId, tenantId: input.tenantId })
    const recipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
    })
    return {
      messageId: input.messageId,
      messageDeletedAt: toIso(message?.deletedAt),
      recipientId: recipient?.id ?? null,
      recipientStatus: recipient?.status ?? null,
      recipientDeletedAt: toIso(recipient?.deletedAt),
    } satisfies MessageDeleteUndoState
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = deleteForActorCommandSchema.parse(input)
    const before = result?.executed ?? null
    return {
      actionLabel: 'Delete message for actor',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before,
          after: (snapshots.after as MessageDeleteUndoState | undefined) ?? null,
        } satisfies UndoPayload<MessageDeleteUndoState>,
      },
      snapshotBefore: before,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageDeleteUndoState>>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    if (before.recipientId) {
      const recipient = await em.findOne(MessageRecipient, { id: before.recipientId })
      if (recipient) {
        recipient.status = (before.recipientStatus ?? 'unread') as MessageRecipient['status']
        recipient.deletedAt = toDate(before.recipientDeletedAt)
      }
    } else {
      const tenantId = logEntry.tenantId ?? null
      const organizationId = logEntry.organizationId ?? null
      const message = await findOneWithDecryption(
        em,
        Message,
        { id: before.messageId, tenantId, organizationId },
        undefined,
        { tenantId, organizationId },
      )
      if (message) {
        message.deletedAt = toDate(before.messageDeletedAt)
      }
    }
    await em.flush()
  },
}

const resendFailedCommandSchema = resendFailedSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

/**
 * Resends a sent message to its `failed` external participants as a new message in
 * the same thread, through the same path the original took: the sender's mailbox
 * for a `send_as_user` message, the platform sender otherwise. A former BCC
 * address is never exposed to the others, so it forces a separate send.
 */
const resendFailedCommand: CommandHandler<unknown, { id: string; threadId: string | null; sourceMessageId: string }> = {
  id: 'messages.messages.resend_failed',
  async execute(rawInput, ctx) {
    const input = resendFailedCommandSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const message = await findOneWithDecryption(
      em,
      Message,
      { id: input.messageId, ...scope, deletedAt: null, isDraft: false },
      undefined,
      scope,
    )
    if (!message) throw notFound(translate('messages.errors.notFound', 'Message not found'))
    if (message.senderUserId !== input.userId) throw forbidden(translate('messages.errors.resendOnlySender', 'Only the sender can resend a message.'))

    const requestedIds = input.participantIds ? Array.from(new Set(input.participantIds)) : null
    const failed = await findWithDecryption(
      em,
      MessageExternalParticipant,
      { messageId: message.id, ...scope, deliveryStatus: 'failed', ...(requestedIds ? { id: { $in: requestedIds } } : {}) },
      { orderBy: { createdAt: 'asc' } },
      scope,
    )
    if (failed.length === 0 || (requestedIds && failed.length !== requestedIds.length)) {
      throw conflict(translate('messages.errors.nothingToResend', 'There are no failed recipients to resend to.'))
    }

    const externalEmails = Array.from(new Map(failed.map((participant) => [participant.email.toLowerCase(), participant.email])).values())
    const sendSeparately = message.emailSendSeparately || failed.some((participant) => participant.role === 'bcc')
    const bodyFormat = message.bodyFormat === 'markdown' ? 'markdown' as const : 'text' as const

    if (message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE && message.sourceEntityId) {
      const delegated = await delegateComposeToSender(
        ctx.container,
        { userId: input.userId, tenantId: input.tenantId, organizationId: input.organizationId, auth: ctx.auth ?? null },
        {
          senderChannelId: message.sourceEntityId,
          visibility: 'public',
          externalEmails,
          sendSeparately,
          subject: message.subject,
          body: message.body,
          bodyFormat,
          parentMessageId: message.id,
        },
      )
      if (!delegated.ok) throw new CrudHttpError(delegated.status, { error: delegated.error, fieldErrors: delegated.fieldErrors })
      return { id: delegated.messageId, threadId: delegated.threadId, sourceMessageId: message.id }
    }

    const composed = await composeMessageCommand.execute(
      {
        type: message.type,
        visibility: 'public',
        externalEmails,
        sendSeparately,
        subject: message.subject,
        body: message.body,
        bodyFormat,
        priority: message.priority,
        parentMessageId: message.id,
        sendViaEmail: true,
        recipients: [],
        ...scope,
        userId: input.userId,
      },
      ctx,
    )
    return { id: composed.id, threadId: composed.threadId, sourceMessageId: message.id }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = resendFailedCommandSchema.parse(input)
    return {
      actionLabel: 'Resend message to failed recipients',
      resourceKind: 'messages.message',
      resourceId: result.id,
      parentResourceKind: 'messages.message',
      parentResourceId: result.sourceMessageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  // Same undo as compose: the created message is deleted. Mail already handed to a provider cannot be recalled.
  undo: async (args) => composeMessageCommand.undo?.(args),
}

const releaseLogger = createLogger('messages').child({ component: 'scheduled-release' })

const releaseScheduledCommandSchema = z.object({
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
})

type ReleaseScheduledResult = { released: string[]; reverted: string[]; returnedToDraft: string[] }

type ReleaseContainer = CommandRuntimeContext['container']

const SCHEDULED_SEND_BUDGET_EXCEEDED_BODY_KEY = 'messages.notifications.scheduledSendFailed.budgetExceeded'

const isEmailAddress = (value: string) => z.string().email().safeParse(value).success

/**
 * Charges the external email budget once for every external addressee of the
 * message (all "to", cc and bcc participants, so every "send separately" copy).
 * Returns false when the budget refuses; an unavailable budget throws so the
 * release is retried.
 */
async function chargeReleasedMessageBudget(
  container: ReleaseContainer,
  em: EntityManager,
  messageId: string,
  scope: ScheduledReleaseScope,
): Promise<boolean> {
  const message = await findOneWithDecryption(em.fork(), Message, { id: messageId, ...scope, deletedAt: null }, undefined, scope)
  if (!message?.externalEmail || (message.visibility !== 'public' && !message.sendViaEmail)) return true
  const participants = await findWithDecryption(em.fork(), MessageExternalParticipant, { messageId, ...scope }, undefined, scope)
  // Non-email channels (e.g. a phone number on a CRM channel send) are not part of the email budget.
  const emails = [message.externalEmail, ...participants.map((participant) => participant.email)].filter(isEmailAddress)
  if (!emails.length) return true
  try {
    await assertExternalEmailBudget(container, { tenantId: scope.tenantId, userId: message.senderUserId }, emails)
    return true
  } catch (error) {
    if (error instanceof ExternalEmailBudgetError && error.status === 429) return false
    throw error
  }
}

/**
 * Each claim bumps `scheduled_release_attempts`, so the pair (`releasing`,
 * attempts) identifies the current lease: a worker whose lease expired and was
 * claimed again matches no row and changes nothing.
 */
function releaseLeaseFilter(claimed: ClaimedScheduledMessage, scope: ScheduledReleaseScope) {
  return { id: claimed.id, ...scope, status: 'releasing' as const, scheduledReleaseAttempts: claimed.attempts }
}

function reportReleaseError(error: unknown, code: string, claimed: ClaimedScheduledMessage) {
  getTelemetryRuntime()?.reportError(error, { module: 'messages', code, attributes: { messageId: claimed.id, attempts: claimed.attempts } })
}

/**
 * Runs while the claimed message is `releasing`, i.e. still a draft: the retry
 * tick and the editor leave it alone until `flipReleasedMessage` makes it
 * `sent`. Every step before the flip is safe to repeat when an expired lease
 * hands the message to another worker; only the flip that still holds the
 * lease marks participants pending and announces the send.
 */
async function handOffReleasedMessage(
  container: ReleaseContainer,
  em: EntityManager,
  claimed: ClaimedScheduledMessage,
  scope: ScheduledReleaseScope,
): Promise<'released' | 'budgetExceeded' | 'superseded'> {
  const message = await findOneWithDecryption(em.fork(), Message, { ...releaseLeaseFilter(claimed, scope), deletedAt: null }, undefined, scope)
  if (!message) return 'superseded'
  // Charged before anything is delivered; a refusal delivers nothing.
  if (!(await chargeReleasedMessageBudget(container, em, claimed.id, scope))) return 'budgetExceeded'
  const route = resolveEmailDeliveryRoute(message, draftSendsViaEmail(message))
  const markPending = message.senderChannelId
    ? await handOffReleasedToMailbox(container, em, message, message.senderChannelId, claimed, scope)
    : participantsAwaitDelivery(message, route)
  if (!(await flipReleasedMessage(em, claimed, scope, route, markPending))) return 'superseded'
  await announceReleasedMessage(container, em, claimed, scope)
  return 'released'
}

async function flipReleasedMessage(
  em: EntityManager,
  claimed: ClaimedScheduledMessage,
  scope: ScheduledReleaseScope,
  route: EmailDeliveryRoute | null,
  markPending: boolean,
): Promise<boolean> {
  return em.fork().transactional(async (trx) => {
    const flipped = await trx.nativeUpdate(
      Message,
      releaseLeaseFilter(claimed, scope),
      { status: 'sent', isDraft: false, sentAt: new Date(), scheduledAt: null, emailDeliveryRoute: route },
    )
    if (!flipped) return false
    await trx.nativeUpdate(Message, { id: claimed.id, ...scope, threadId: null }, { threadId: claimed.id })
    if (markPending) await markDraftParticipantsPending(trx, { messageId: claimed.id, ...scope })
    return true
  })
}

/**
 * The message is already sent, so a failure here is reported, never reverted:
 * recipients are not notified twice, and pending participants are picked up by
 * the retry tick through the route recorded by the flip.
 */
async function announceReleasedMessage(
  container: ReleaseContainer,
  em: EntityManager,
  claimed: ClaimedScheduledMessage,
  scope: ScheduledReleaseScope,
): Promise<void> {
  const messageId = claimed.id
  try {
    const readEm = em.fork()
    const message = await findOneWithDecryption(readEm, Message, { id: messageId, ...scope, deletedAt: null }, undefined, scope)
    if (!message) return
    const recipients = await findWithDecryption(readEm, MessageRecipient, { messageId, deletedAt: null }, undefined, scope)
    await emitMessageIndexUpsert(container, { messageId, ...scope })
    await invalidateCrudCache(
      container,
      'messages.message',
      { id: messageId, ...scope },
      scope.tenantId,
      `command:${RELEASE_SCHEDULED_COMMAND_ID}:execute`,
    )
    await emitDraftSentEvent(container, message, recipients.map((recipient) => recipient.recipientUserId))
  } catch (error) {
    releaseLogger.warn('Released scheduled message could not be announced', { messageId, err: error })
    reportReleaseError(error, 'messages.scheduled_release_announce_failed', claimed)
  }
}

/**
 * Returns whether the flip still has to mark the participants pending: a
 * previous attempt that already linked the message counts as handed off, and
 * its participants may have been cleared by a revert. A mailbox that cannot
 * deliver (or no mailbox module) or cannot carry the message's attachments
 * fails the participants instead of retrying; any other refusal throws so the
 * release is reverted.
 */
async function handOffReleasedToMailbox(
  container: ReleaseContainer,
  em: EntityManager,
  message: Message,
  senderChannelId: string,
  claimed: ClaimedScheduledMessage,
  scope: ScheduledReleaseScope,
): Promise<boolean> {
  const result = await handOffMessageToSender(
    container,
    { userId: message.senderUserId, ...scope },
    { senderChannelId, messageId: message.id, expectedReleaseAttempts: claimed.attempts },
  )
  if (result.ok) return false
  if (result.code === 'already_linked' || result.code === 'release_superseded') return true
  if (!result.code) {
    throw new Error(`[internal] mailbox hand-off refused (${result.status}): ${result.error}`)
  }
  const failureReason = result.code === 'channel_unavailable' ? MAILBOX_UNAVAILABLE_ERROR : result.error
  // Marked as mailbox-routed like a delivered one, so "resend to failed" retries through the mailbox, not the platform sender.
  const marked = await em.fork().transactional(async (trx) => {
    const updated = await trx.nativeUpdate(
      Message,
      releaseLeaseFilter(claimed, scope),
      { sourceEntityType: SEND_AS_USER_SOURCE_ENTITY_TYPE, sourceEntityId: senderChannelId, emailDeliveryRoute: 'send_as_user' },
    )
    if (updated) await markDraftParticipantsPending(trx, { messageId: message.id, ...scope })
    return updated > 0
  })
  if (!marked) return false
  const pending = await findWithDecryption(
    em.fork(),
    MessageExternalParticipant,
    { messageId: message.id, ...scope, deliveryStatus: 'pending' },
    undefined,
    scope,
  )
  await settleExternalParticipants(
    em.fork(),
    { messageId: message.id, ...scope },
    { failed: pending.map((participant) => ({ id: participant.id, error: failureReason })) },
    { pendingOnly: true },
  )
  return false
}

async function notifyScheduledSendFailed(
  container: ReleaseContainer,
  em: EntityManager,
  messageId: string,
  scope: ScheduledReleaseScope,
  budgetExceeded: boolean,
) {
  const typeDef = notificationTypes.find((type) => type.type === 'messages.scheduled_send_failed')
  if (!typeDef) return
  const message = await findOneWithDecryption(em.fork(), Message, { id: messageId, ...scope, deletedAt: null }, undefined, scope)
  if (!message) return
  const variables = { subject: message.subject ?? '' }
  await resolveNotificationService(container).createBatch(
    buildBatchNotificationFromType(budgetExceeded ? { ...typeDef, bodyKey: SCHEDULED_SEND_BUDGET_EXCEEDED_BODY_KEY } : typeDef, {
      recipientUserIds: [message.senderUserId],
      titleVariables: variables,
      bodyVariables: variables,
      sourceEntityType: 'message',
      sourceEntityId: message.id,
      linkHref: `/backend/messages/${message.id}`,
      groupKey: `messages.scheduled_send_failed:${message.id}`,
    }),
    scope,
  )
}

/**
 * Hand-off failed: retry on the next tick, or give up after the attempt cap and
 * return the message to the author's drafts. A refused budget is not retried.
 * Only a worker still holding the lease reverts; a superseded one leaves the
 * message and its participants to the current lease holder.
 */
async function revertFailedRelease(
  container: ReleaseContainer,
  em: EntityManager,
  claimed: ClaimedScheduledMessage,
  scope: ScheduledReleaseScope,
  budgetExceeded = false,
): Promise<'reverted' | 'returnedToDraft' | 'superseded'> {
  const toDraft = budgetExceeded || claimed.attempts >= MAX_SCHEDULED_RELEASE_ATTEMPTS
  const reverted = await em.fork().transactional(async (trx) => {
    const updated = await trx.nativeUpdate(
      Message,
      releaseLeaseFilter(claimed, scope),
      toDraft
        ? { status: 'draft', isDraft: true, sentAt: null, scheduledAt: null }
        : { status: 'scheduled', isDraft: true, sentAt: null, scheduledAt: claimed.scheduledAt ?? new Date() },
    )
    if (!updated) return false
    await trx.nativeUpdate(
      MessageExternalParticipant,
      { messageId: claimed.id, ...scope, deliveryStatus: 'pending' },
      { deliveryStatus: null },
    )
    return true
  })
  if (!reverted) return 'superseded'
  if (!toDraft) return 'reverted'
  try {
    await notifyScheduledSendFailed(container, em, claimed.id, scope, budgetExceeded)
  } catch (error) {
    releaseLogger.warn('Failed to notify the author about a failed scheduled send', { messageId: claimed.id, err: error })
    reportReleaseError(error, 'messages.scheduled_release_notify_failed', claimed)
  }
  return 'returnedToDraft'
}

/**
 * Worker-only: sends the organization's due scheduled messages through the same
 * path as sending a draft. Not undoable — the release is the send.
 */
const releaseScheduledCommand: CommandHandler<unknown, ReleaseScheduledResult> = {
  id: RELEASE_SCHEDULED_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = releaseScheduledCommandSchema.parse(rawInput)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result: ReleaseScheduledResult = { released: [], reverted: [], returnedToDraft: [] }
    const record = (outcome: 'released' | 'reverted' | 'returnedToDraft' | 'superseded', id: string) => {
      if (outcome !== 'superseded') result[outcome].push(id)
    }
    const claimed = await claimDueScheduledMessages(em, scope)
    for (const item of claimed) {
      try {
        const outcome = await handOffReleasedMessage(ctx.container, em, item, scope)
        record(outcome === 'budgetExceeded' ? await revertFailedRelease(ctx.container, em, item, scope, true) : outcome, item.id)
      } catch (error) {
        releaseLogger.warn('Scheduled message hand-off failed', { messageId: item.id, attempts: item.attempts, err: error })
        reportReleaseError(error, 'messages.scheduled_release_handoff_failed', item)
        record(await revertFailedRelease(ctx.container, em, item, scope), item.id)
      }
    }
    return result
  },
  buildLog: async ({ input, result }) => {
    if (result.released.length + result.reverted.length + result.returnedToDraft.length === 0) return { skipLog: true }
    const parsed = releaseScheduledCommandSchema.parse(input)
    return {
      actionLabel: 'Release scheduled messages',
      resourceKind: 'messages.message',
      resourceId: result.released.length === 1 ? result.released[0] : null,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      replayable: false,
      payload: result,
    }
  },
}

registerCommand(composeMessageCommand)
registerCommand(updateDraftCommand)
registerCommand(replyMessageCommand)
registerCommand(forwardMessageCommand)
registerCommand(deleteForActorCommand)
registerCommand(resendFailedCommand)
registerCommand(releaseScheduledCommand)
