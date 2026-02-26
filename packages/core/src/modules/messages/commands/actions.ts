import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message, MessageObject, MessageRecipient } from '../data/entities'
import { emitMessagesEvent } from '../events'
import {
  findResolvedMessageActionById,
  isTerminalMessageAction,
  resolveActionCommandInput,
  resolveActionHref,
} from '../lib/actions'
import { getMessageType } from '../lib/message-types-registry'
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

const executeActionSchema = z.object({
  messageId: z.string().uuid(),
  actionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

type ExecuteActionInput = z.infer<typeof executeActionSchema>

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

async function requireActionMessage(em: EntityManager, input: ExecuteActionInput) {
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

const executeActionCommand: CommandHandler<
  unknown,
  { ok: true; actionId: string; result: Record<string, unknown>; operationLogEntry: unknown | null }
> = {
  id: 'messages.actions.execute',
  async execute(rawInput, ctx) {
    const input = executeActionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireActionMessage(em, input)
    const objects = await em.find(MessageObject, { messageId: message.id })
    const action = findResolvedMessageActionById(message, objects, input.actionId)

    if (!action) {
      throw new Error('Action not found')
    }

    if (message.actionTaken) {
      throw Object.assign(new Error('Action already taken'), { actionTaken: message.actionTaken })
    }

    const shouldRecordActionTaken = isTerminalMessageAction(action)

    if (message.actionData?.expiresAt) {
      if (new Date(message.actionData.expiresAt) < new Date()) {
        throw new Error('Actions have expired')
      }
    } else {
      const messageType = getMessageType(message.type)
      if (messageType?.actionsExpireAfterHours && message.sentAt) {
        const expiry = new Date(message.sentAt.getTime() + messageType.actionsExpireAfterHours * 60 * 60 * 1000)
        if (expiry < new Date()) {
          throw new Error('Actions have expired')
        }
      }
    }

    const commandBus = ctx.container.resolve('commandBus') as {
      execute: (
        commandId: string,
        options: { input: unknown; ctx: unknown; metadata?: unknown }
      ) => Promise<{ result: unknown; logEntry?: unknown }>
    }

    let result: Record<string, unknown> = {}
    let operationLogEntry: unknown | null = null

    if (action.commandId) {
      try {
        const actionInput = resolveActionCommandInput(
          action,
          message,
          {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            userId: input.userId,
          },
          input.payload ?? {},
        )

        if (actionInput.id == null) {
          const fallbackId = action.objectRef?.entityId ?? message.sourceEntityId ?? null
          if (typeof fallbackId === 'string' && fallbackId.trim().length > 0) {
            actionInput.id = fallbackId
          }
        }

        const commandResult = await commandBus.execute(action.commandId, {
          input: actionInput,
          ctx: {
            container: ctx.container,
            auth: {
              sub: input.userId,
              tenantId: input.tenantId,
              orgId: input.organizationId,
            },
            organizationScope: null,
            selectedOrganizationId: input.organizationId,
            organizationIds: input.organizationId ? [input.organizationId] : null,
          },
          metadata: {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            resourceKind: 'messages',
          },
        })

        result = (commandResult.result as Record<string, unknown>) ?? {}
        operationLogEntry = commandResult.logEntry ?? null
      } catch (err) {
        console.error('[messages] executeActionCommand sub-command failed', err)
        throw new Error('Action failed')
      }
    } else if (action.href) {
      result = {
        redirect: resolveActionHref(action, message, {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          userId: input.userId,
        }) ?? action.href,
      }
    } else {
      throw new Error('Action has no executable target')
    }

    if (shouldRecordActionTaken) {
      await commandBus.execute('messages.actions.record_terminal', {
        input: {
          messageId: message.id,
          actionId: action.id,
          result,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          userId: input.userId,
        },
        ctx: {
          container: ctx.container,
          auth: ctx.auth ?? null,
          organizationScope: null,
          selectedOrganizationId: input.organizationId,
          organizationIds: input.organizationId ? [input.organizationId] : null,
        },
      })
      await emitMessagesEvent(
        'messages.message.action_taken',
        {
          messageId: message.id,
          actionId: action.id,
          userId: input.userId,
          result,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        },
        { persistent: true }
      )
    }

    return {
      ok: true,
      actionId: action.id,
      result,
      operationLogEntry,
    }
  },
}

registerCommand(recordTerminalActionCommand)
registerCommand(executeActionCommand)
