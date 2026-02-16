import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message, MessageRecipient } from '../data/entities'
import { assertOrganizationAccess, type MessageRecipientSnapshot, type MessageScopeInput } from './shared'

const recipientMutationSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

type RecipientMutationInput = z.infer<typeof recipientMutationSchema>

type RecipientUndoPayload = UndoPayload<MessageRecipientSnapshot>

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

async function loadRecipientForMutation(em: EntityManager, input: RecipientMutationInput) {
  const message = await em.findOne(Message, {
    id: input.messageId,
    tenantId: input.tenantId,
    deletedAt: null,
  })
  if (!message) throw new Error('Message not found')
  assertOrganizationAccess(input as MessageScopeInput, message)

  const recipient = await em.findOne(MessageRecipient, {
    messageId: input.messageId,
    recipientUserId: input.userId,
    deletedAt: null,
  })
  if (!recipient) throw new Error('Access denied')

  return { message, recipient }
}

function snapshotRecipient(recipient: MessageRecipient): MessageRecipientSnapshot {
  return {
    id: recipient.id,
    messageId: recipient.messageId,
    recipientUserId: recipient.recipientUserId,
    recipientType: recipient.recipientType,
    status: recipient.status,
    readAt: toIso(recipient.readAt),
    archivedAt: toIso(recipient.archivedAt),
    deletedAt: toIso(recipient.deletedAt),
  }
}

function buildLog(actionLabel: string, payload: RecipientUndoPayload, input: RecipientMutationInput) {
  return {
    actionLabel,
    resourceKind: 'messages.message',
    resourceId: input.messageId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: { undo: payload },
    snapshotBefore: payload.before ?? null,
    snapshotAfter: payload.after ?? null,
  }
}

function applyRecipientSnapshot(recipient: MessageRecipient, snapshot: MessageRecipientSnapshot) {
  recipient.status = snapshot.status
  recipient.readAt = toDate(snapshot.readAt)
  recipient.archivedAt = toDate(snapshot.archivedAt)
  recipient.deletedAt = toDate(snapshot.deletedAt)
}

const markReadCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.recipients.mark_read',
  async prepare(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return { before: snapshotRecipient(recipient) }
  },
  async execute(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    if (recipient.status !== 'read') {
      recipient.status = 'read'
      recipient.readAt = new Date()
      await em.flush()
    }
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return snapshotRecipient(recipient)
  },
  async buildLog({ input, snapshots }) {
    const parsed = recipientMutationSchema.parse(input)
    return buildLog('Mark message as read', {
      before: (snapshots.before as MessageRecipientSnapshot | undefined) ?? null,
      after: (snapshots.after as MessageRecipientSnapshot | undefined) ?? null,
    }, parsed)
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RecipientUndoPayload>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const recipient = await em.findOne(MessageRecipient, { id: before.id })
    if (!recipient) return
    applyRecipientSnapshot(recipient, before)
    await em.flush()
  },
}

const markUnreadCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.recipients.mark_unread',
  async prepare(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return { before: snapshotRecipient(recipient) }
  },
  async execute(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    recipient.status = 'unread'
    recipient.readAt = null
    await em.flush()
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return snapshotRecipient(recipient)
  },
  async buildLog({ input, snapshots }) {
    const parsed = recipientMutationSchema.parse(input)
    return buildLog('Mark message as unread', {
      before: (snapshots.before as MessageRecipientSnapshot | undefined) ?? null,
      after: (snapshots.after as MessageRecipientSnapshot | undefined) ?? null,
    }, parsed)
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RecipientUndoPayload>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const recipient = await em.findOne(MessageRecipient, { id: before.id })
    if (!recipient) return
    applyRecipientSnapshot(recipient, before)
    await em.flush()
  },
}

const archiveRecipientCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.recipients.archive',
  async prepare(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return { before: snapshotRecipient(recipient) }
  },
  async execute(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    recipient.archivedAt = new Date()
    recipient.status = 'archived'
    await em.flush()
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return snapshotRecipient(recipient)
  },
  async buildLog({ input, snapshots }) {
    const parsed = recipientMutationSchema.parse(input)
    return buildLog('Archive message', {
      before: (snapshots.before as MessageRecipientSnapshot | undefined) ?? null,
      after: (snapshots.after as MessageRecipientSnapshot | undefined) ?? null,
    }, parsed)
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RecipientUndoPayload>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const recipient = await em.findOne(MessageRecipient, { id: before.id })
    if (!recipient) return
    applyRecipientSnapshot(recipient, before)
    await em.flush()
  },
}

const unarchiveRecipientCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.recipients.unarchive',
  async prepare(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return { before: snapshotRecipient(recipient) }
  },
  async execute(rawInput, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    recipient.archivedAt = null
    recipient.status = recipient.readAt ? 'read' : 'unread'
    await em.flush()
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = recipientMutationSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { recipient } = await loadRecipientForMutation(em, input)
    return snapshotRecipient(recipient)
  },
  async buildLog({ input, snapshots }) {
    const parsed = recipientMutationSchema.parse(input)
    return buildLog('Unarchive message', {
      before: (snapshots.before as MessageRecipientSnapshot | undefined) ?? null,
      after: (snapshots.after as MessageRecipientSnapshot | undefined) ?? null,
    }, parsed)
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RecipientUndoPayload>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const recipient = await em.findOne(MessageRecipient, { id: before.id })
    if (!recipient) return
    applyRecipientSnapshot(recipient, before)
    await em.flush()
  },
}

registerCommand(markReadCommand)
registerCommand(markUnreadCommand)
registerCommand(archiveRecipientCommand)
registerCommand(unarchiveRecipientCommand)
