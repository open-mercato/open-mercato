import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { Message, MessageConfirmation, MessageRecipient } from '../data/entities'
import { confirmMessageSchema } from '../data/validators'

type ConfirmMessageResult = {
  messageId: string
  confirmed: boolean
  confirmedAt: string | null
  confirmedByUserId: string | null
}

const confirmMessageCommand: CommandHandler<unknown, ConfirmMessageResult> = {
  id: 'messages.confirmations.confirm',
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
}

registerCommand(confirmMessageCommand)
