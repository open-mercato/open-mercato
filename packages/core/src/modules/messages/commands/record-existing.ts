import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageObject, MessageRecipient, type MessageActionData } from '../data/entities'
import {
  messageActionDataSchema,
  messageObjectSchema,
  messageRecipientSchema,
} from '../data/validators'
import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage } from '../lib/attachments'
import { MESSAGE_ENTITY_ID } from '../lib/constants'
import { validateMessageObjectsForType } from '../lib/object-validation'

const recordExistingMessageSchema = z.object({
  type: z.string().optional().default('default'),
  visibility: z.enum(['public', 'internal']).nullable().optional(),
  sourceEntityType: z.string().min(1),
  sourceEntityId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(255),
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
  parentMessageId: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  recordedByUserId: z.string().uuid(),
}).strict()

export type RecordExistingMessageInput = z.infer<typeof recordExistingMessageSchema>

export type RecordExistingMessageResult = {
  id: string
  threadId: string | null
  externalEmail: string | null
  recipientUserIds: string[]
  deduplicated?: boolean
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: string }).code === '23505') return true
  const message = (error as { message?: string }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}

async function buildExistingResult(
  em: EntityManager,
  message: Message,
): Promise<RecordExistingMessageResult> {
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
    recipientUserIds: recipients.map((recipient) => recipient.recipientUserId),
    deduplicated: true,
  }
}

async function findExisting(
  em: EntityManager,
  input: RecordExistingMessageInput,
): Promise<Message | null> {
  return findOneWithDecryption(
    em,
    Message,
    {
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function emitMessageIndexUpsert(
  container: { resolve: (name: string) => unknown },
  input: RecordExistingMessageInput,
  messageId: string,
): Promise<void> {
  let resolvedEventBus: unknown
  try {
    resolvedEventBus = container.resolve('eventBus')
  } catch {
    return
  }
  if (!resolvedEventBus || typeof resolvedEventBus !== 'object') return
  const eventBus = resolvedEventBus as {
    emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void>
  }
  if (typeof eventBus.emitEvent !== 'function') return
  await eventBus.emitEvent(
    'query_index.upsert_one',
    {
      entityType: MESSAGE_ENTITY_ID,
      recordId: messageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      crudAction: 'created',
      coverageBaseDelta: 1,
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  ).catch(() => undefined)
}

const recordExistingMessageCommand: CommandHandler<unknown, RecordExistingMessageResult> = {
  id: 'messages.messages.record_existing',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = recordExistingMessageSchema.parse(rawInput)
    if (input.objects?.length) {
      const validationError = validateMessageObjectsForType(input.type, input.objects)
      if (validationError) throw new Error(validationError)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await findExisting(em, input)
    if (existing) return buildExistingResult(em, existing)

    let messageId = ''
    let threadId: string | null = null
    try {
      await em.transactional(async (trx) => {
        const parent = input.parentMessageId
          ? await findOneWithDecryption(
              trx,
              Message,
              {
                id: input.parentMessageId,
                tenantId: input.tenantId,
                organizationId: input.organizationId,
                deletedAt: null,
              },
              undefined,
              { tenantId: input.tenantId, organizationId: input.organizationId },
            )
          : null
        const message = trx.create(Message, {
          type: input.type,
          visibility: input.visibility ?? null,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          externalEmail: input.externalEmail,
          externalName: input.externalName,
          threadId: parent?.threadId ?? parent?.id,
          parentMessageId: input.parentMessageId,
          senderUserId: input.recordedByUserId,
          subject: input.subject,
          body: input.body,
          bodyFormat: input.bodyFormat,
          priority: input.priority,
          status: 'sent',
          isDraft: false,
          sentAt: new Date(),
          actionData: input.actionData as MessageActionData | undefined,
          sendViaEmail: false,
          idempotencyKey: input.idempotencyKey,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        })
        await trx.persist(message).flush()
        if (!message.threadId) {
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
        for (const object of input.objects ?? []) {
          trx.persist(trx.create(MessageObject, {
            messageId: message.id,
            entityModule: object.entityModule,
            entityType: object.entityType,
            entityId: object.entityId,
            actionRequired: object.actionRequired,
            actionType: object.actionType,
            actionLabel: object.actionLabel,
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
        threadId = message.threadId ?? null
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await findExisting(em.fork(), input)
        if (winner) return buildExistingResult(em.fork(), winner)
      }
      throw error
    }

    await emitMessageIndexUpsert(ctx.container, input, messageId)
    return {
      id: messageId,
      threadId,
      externalEmail: input.externalEmail ?? null,
      recipientUserIds: input.recipients.map((recipient) => recipient.userId),
    }
  },
  buildLog: ({ input, result }) => {
    if (result.deduplicated) return { skipLog: true }
    const parsed = recordExistingMessageSchema.parse(input)
    return {
      actionLabel: 'Record existing message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    }
  },
}

registerCommand(recordExistingMessageCommand)

export default recordExistingMessageCommand
