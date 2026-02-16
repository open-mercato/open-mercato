import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message, MessageRecipient } from '../data/entities'
import { assertOrganizationAccess, type MessageScopeInput } from './shared'

const recordTerminalActionSchema = z.object({
  messageId: z.string().uuid(),
  actionId: z.string().min(1),
  result: z.record(z.string(), z.unknown()),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

type RecordTerminalActionInput = z.infer<typeof recordTerminalActionSchema>

type ActionStateSnapshot = {
  actionTaken: string | null
  actionTakenByUserId: string | null
  actionTakenAt: string | null
  actionResult: Record<string, unknown> | null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

async function requireActionTarget(em: EntityManager, input: RecordTerminalActionInput) {
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
  return message
}

function snapshotActionState(message: Message): ActionStateSnapshot {
  return {
    actionTaken: message.actionTaken ?? null,
    actionTakenByUserId: message.actionTakenByUserId ?? null,
    actionTakenAt: toIso(message.actionTakenAt),
    actionResult: message.actionResult ?? null,
  }
}

const recordTerminalActionCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.actions.record_terminal',
  async prepare(rawInput, ctx) {
    const input = recordTerminalActionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireActionTarget(em, input)
    return { before: snapshotActionState(message) }
  },
  async execute(rawInput, ctx) {
    const input = recordTerminalActionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireActionTarget(em, input)
    if (message.actionTaken) {
      throw new Error('Action already taken')
    }
    message.actionTaken = input.actionId
    message.actionTakenByUserId = input.userId
    message.actionTakenAt = new Date()
    message.actionResult = input.result
    await em.flush()
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = recordTerminalActionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireActionTarget(em, input)
    return snapshotActionState(message)
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = recordTerminalActionSchema.parse(input)
    return {
      actionLabel: 'Execute message terminal action',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as ActionStateSnapshot | undefined) ?? null,
          after: (snapshots.after as ActionStateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<ActionStateSnapshot>,
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<ActionStateSnapshot>>(logEntry)
    const before = undo?.before
    if (!before) return
    const messageId = logEntry?.resourceId as string | null
    if (!messageId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: messageId })
    if (!message) return
    message.actionTaken = before.actionTaken
    message.actionTakenByUserId = before.actionTakenByUserId
    message.actionTakenAt = toDate(before.actionTakenAt)
    message.actionResult = before.actionResult
    await em.flush()
  },
}

registerCommand(recordTerminalActionCommand)
