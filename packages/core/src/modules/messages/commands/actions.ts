import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageObject, MessageRecipient } from '../data/entities'
import { emitMessagesEvent } from '../events'
import { MESSAGE_OPTIMISTIC_LOCK_RESOURCE_KIND } from '../lib/constants'
import {
  findResolvedMessageActionById,
  isTerminalMessageAction,
  resolveActionCommandInput,
  resolveActionHref,
  resolveMessageActionData,
} from '../lib/actions'
import { getMessageType } from '../lib/message-types-registry'
import { assertOrganizationAccess, type MessageScopeInput } from './shared'

const actionStateSnapshotSchema = z.object({
  actionTaken: z.string().nullable(),
  actionTakenByUserId: z.string().nullable(),
  actionTakenAt: z.string().nullable(),
  actionResult: z.record(z.string(), z.unknown()).nullable(),
})

const recordTerminalActionSchema = z.object({
  messageId: z.string().uuid(),
  actionId: z.string().min(1),
  result: z.record(z.string(), z.unknown()),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  // Optional pre-claim snapshot supplied by `messages.actions.execute` so the
  // undo log records the true (un-taken) state even though the terminal action
  // was atomically claimed before this finalizer runs.
  previousState: actionStateSnapshotSchema.optional(),
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
  const message = await findOneWithDecryption(
    em,
    Message,
    {
      id: input.messageId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
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
  const message = await findOneWithDecryption(
    em,
    Message,
    {
      id: input.messageId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
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
    const claimedByCaller =
      message.actionTaken === input.actionId && message.actionTakenByUserId === input.userId
    if (!claimedByCaller) {
      if (message.actionTaken) {
        throw new Error('Action already taken')
      }
      // Atomic compare-and-set: only one concurrent request transitions the
      // message out of the un-taken state. nativeUpdate runs as a single
      // `UPDATE ... WHERE action_taken IS NULL` so the loser matches 0 rows.
      const claimedRows = await em.nativeUpdate(
        Message,
        { id: input.messageId, tenantId: input.tenantId, actionTaken: null, deletedAt: null },
        {
          actionTaken: input.actionId,
          actionTakenByUserId: input.userId,
          actionTakenAt: new Date(),
        },
      )
      if (claimedRows === 0) {
        throw new Error('Action already taken')
      }
      message.actionTaken = input.actionId
      message.actionTakenByUserId = input.userId
    }
    if (!message.actionTakenAt) {
      message.actionTakenAt = new Date()
    }
    // action_result is an encrypted column, so it must be written through the
    // flush path (the encryption subscriber) rather than nativeUpdate.
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
    // When the action was pre-claimed by `messages.actions.execute`, the
    // prepare-captured snapshot already reflects the claimed state, so prefer
    // the explicit pre-claim snapshot for the undo baseline.
    const before =
      (parsed.previousState as ActionStateSnapshot | undefined) ??
      (snapshots.before as ActionStateSnapshot | undefined) ??
      null
    return {
      actionLabel: 'Execute message terminal action',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before,
          after: (snapshots.after as ActionStateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<ActionStateSnapshot>,
      },
      snapshotBefore: before,
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
    const message = await findOneWithDecryption(em, Message, { id: messageId })
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

    // Reject a stale action: if the message changed since the actor's tab loaded
    // it (and the client sent the expected version), fail with the structured 409
    // conflict instead of acting on an out-of-date aggregate. Strictly additive —
    // a no-op for callers that don't send the optimistic-lock header.
    enforceCommandOptimisticLock({
      resourceKind: MESSAGE_OPTIMISTIC_LOCK_RESOURCE_KIND,
      resourceId: message.id,
      current: message.updatedAt,
      request: ctx.request ?? null,
    })

    const objects = await em.find(MessageObject, { messageId: message.id })
    const action = findResolvedMessageActionById(message, objects, input.actionId)

    if (!action) {
      throw new Error('Action not found')
    }

    if (message.actionTaken) {
      throw Object.assign(new Error('Action already taken'), { actionTaken: message.actionTaken })
    }

    const shouldRecordActionTaken = isTerminalMessageAction(action)

    const actionData = resolveMessageActionData(message)
    if (actionData?.expiresAt) {
      if (new Date(actionData.expiresAt) < new Date()) {
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

    // Capture the un-taken state for the undo log before reserving the action.
    const previousState = snapshotActionState(message)
    let claimedTerminal = false
    const releaseTerminalClaim = async () => {
      if (!claimedTerminal) return
      claimedTerminal = false
      await em.nativeUpdate(
        Message,
        {
          id: message.id,
          tenantId: input.tenantId,
          actionTaken: action.id,
          actionTakenByUserId: input.userId,
        },
        { actionTaken: null, actionTakenByUserId: null, actionTakenAt: null },
      )
    }

    if (shouldRecordActionTaken) {
      // Atomically reserve the terminal action BEFORE running the target
      // command so concurrent requests cannot both execute it. The losing
      // request matches 0 rows and surfaces the existing 409 response.
      const claimedRows = await em.nativeUpdate(
        Message,
        { id: message.id, tenantId: input.tenantId, actionTaken: null, deletedAt: null },
        {
          actionTaken: action.id,
          actionTakenByUserId: input.userId,
          actionTakenAt: new Date(),
        },
      )
      if (claimedRows === 0) {
        const current = await findOneWithDecryption(
          em,
          Message,
          { id: message.id, tenantId: input.tenantId, deletedAt: null },
          undefined,
          { tenantId: input.tenantId, organizationId: input.organizationId },
        )
        throw Object.assign(new Error('Action already taken'), {
          actionTaken: current?.actionTaken ?? message.actionTaken ?? action.id,
        })
      }
      claimedTerminal = true
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
        // The target command never completed — release the reservation so the
        // action stays retryable, matching the pre-claim failure semantics.
        await releaseTerminalClaim()
        throw new Error('Action failed')
      }
    } else if (action.href) {
      const safeRedirect = resolveActionHref(action, message, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.userId,
      })
      if (!safeRedirect) {
        await releaseTerminalClaim()
        throw new Error('Action has an unsafe redirect target')
      }
      result = { redirect: safeRedirect }
    } else {
      await releaseTerminalClaim()
      throw new Error('Action has no executable target')
    }

    if (shouldRecordActionTaken) {
      const terminalResult = await commandBus.execute('messages.actions.record_terminal', {
        input: {
          messageId: message.id,
          actionId: action.id,
          result,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          userId: input.userId,
          previousState,
        },
        ctx: {
          container: ctx.container,
          auth: ctx.auth ?? null,
          organizationScope: null,
          selectedOrganizationId: input.organizationId,
          organizationIds: input.organizationId ? [input.organizationId] : null,
        },
      })
      if (!operationLogEntry) {
        operationLogEntry = terminalResult.logEntry ?? null
      }
      await emitMessagesEvent(
        'messages.message.action_taken',
        {
          messageId: message.id,
          actionId: action.id,
          userId: input.userId,
          recipientUserId: input.userId,
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
