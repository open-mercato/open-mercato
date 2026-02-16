import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message, MessageConfirmation, MessageRecipient } from '../data/entities'
import { confirmMessageSchema } from '../data/validators'

type ConfirmMessageResult = {
  messageId: string
  confirmed: boolean
  confirmedAt: string | null
  confirmedByUserId: string | null
}

type ConfirmationSnapshot = {
  id: string | null
  messageId: string
  confirmed: boolean
  confirmedAt: string | null
  confirmedByUserId: string | null
  tenantId: string
  organizationId: string | null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

const confirmMessageCommand: CommandHandler<unknown, ConfirmMessageResult> = {
  id: 'messages.confirmations.confirm',
  async prepare(rawInput, ctx) {
    const input = confirmMessageSchema.parse(rawInput)
    const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
    if (!tenantId) throw new Error('Tenant scope is required')
    const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(MessageConfirmation, { messageId: input.messageId })
    return {
      before: {
        id: existing?.id ?? null,
        messageId: input.messageId,
        confirmed: existing?.confirmed ?? false,
        confirmedAt: toIso(existing?.confirmedAt),
        confirmedByUserId: existing?.confirmedByUserId ?? null,
        tenantId,
        organizationId,
      } satisfies ConfirmationSnapshot,
    }
  },
  async execute(rawInput, ctx) {
    const input = confirmMessageSchema.parse(rawInput)
    const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null

    if (!tenantId) {
      throw new Error('Tenant scope is required')
    }

    const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const message = await em.findOne(Message, {
      id: input.messageId,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!message) {
      throw new Error('Message not found')
    }

    const actorUserId = ctx.auth?.sub ?? null
    if (!actorUserId) {
      throw new Error('Authentication required')
    }

    const recipient = await em.findOne(MessageRecipient, {
      messageId: message.id,
      recipientUserId: actorUserId,
      deletedAt: null,
    })
    const isSender = message.senderUserId === actorUserId
    if (!isSender && !recipient) {
      throw new Error('Access denied')
    }

    let confirmation = await em.findOne(MessageConfirmation, { messageId: message.id })
    if (!confirmation) {
      confirmation = em.create(MessageConfirmation, {
        messageId: message.id,
        tenantId,
        organizationId,
      })
    }

    confirmation.confirmed = input.confirmed
    confirmation.confirmedByUserId = actorUserId
    confirmation.confirmedAt = input.confirmed ? new Date() : null

    await em.persistAndFlush(confirmation)

    return {
      messageId: confirmation.messageId,
      confirmed: confirmation.confirmed,
      confirmedAt: confirmation.confirmedAt ? confirmation.confirmedAt.toISOString() : null,
      confirmedByUserId: confirmation.confirmedByUserId ?? null,
    }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = confirmMessageSchema.parse(rawInput)
    const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
    if (!tenantId) return null
    const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const confirmation = await em.findOne(MessageConfirmation, { messageId: input.messageId })
    return {
      id: confirmation?.id ?? null,
      messageId: input.messageId,
      confirmed: confirmation?.confirmed ?? false,
      confirmedAt: toIso(confirmation?.confirmedAt),
      confirmedByUserId: confirmation?.confirmedByUserId ?? null,
      tenantId,
      organizationId,
    } satisfies ConfirmationSnapshot
  },
  async buildLog({ input, snapshots }) {
    const parsed = confirmMessageSchema.parse(input)
    return {
      actionLabel: parsed.confirmed ? 'Confirm message' : 'Unconfirm message',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId ?? null,
      organizationId: parsed.organizationId ?? null,
      payload: {
        undo: {
          before: (snapshots.before as ConfirmationSnapshot | undefined) ?? null,
          after: (snapshots.after as ConfirmationSnapshot | undefined) ?? null,
        } satisfies UndoPayload<ConfirmationSnapshot>,
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<ConfirmationSnapshot>>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(MessageConfirmation, { messageId: before.messageId })
    if (!before.id) {
      if (existing) {
        em.remove(existing)
        await em.flush()
      }
      return
    }
    if (!existing) {
      em.persist(em.create(MessageConfirmation, {
        id: before.id,
        messageId: before.messageId,
        confirmed: before.confirmed,
        confirmedAt: toDate(before.confirmedAt),
        confirmedByUserId: before.confirmedByUserId,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
      }))
    } else {
      existing.confirmed = before.confirmed
      existing.confirmedAt = toDate(before.confirmedAt)
      existing.confirmedByUserId = before.confirmedByUserId
      existing.tenantId = before.tenantId
      existing.organizationId = before.organizationId
    }
    await em.flush()
  },
}

registerCommand(confirmMessageCommand)
