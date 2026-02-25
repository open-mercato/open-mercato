import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { Message, MessageAccessToken, MessageRecipient } from '../data/entities'
import { emitMessagesEvent } from '../events'

const MAX_TOKEN_USE_COUNT = 25

const consumeTokenSchema = z.object({
  token: z.string().min(1),
})

type ConsumeTokenInput = z.infer<typeof consumeTokenSchema>

const consumeTokenCommand: CommandHandler<unknown, { messageId: string; recipientUserId: string }> = {
  id: 'messages.tokens.consume',
  async execute(rawInput, ctx) {
    const input = consumeTokenSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const accessToken = await em.findOne(MessageAccessToken, { token: input.token })
    if (!accessToken) {
      throw new Error('Invalid or expired link')
    }
    if (accessToken.expiresAt < new Date()) {
      throw new Error('This link has expired')
    }
    if (accessToken.useCount >= MAX_TOKEN_USE_COUNT) {
      throw new Error('This link can no longer be used')
    }

    const message = await em.findOne(Message, {
      id: accessToken.messageId,
      deletedAt: null,
    })
    if (!message) {
      throw new Error('Message not found')
    }

    const recipient = await em.findOne(MessageRecipient, {
      messageId: accessToken.messageId,
      recipientUserId: accessToken.recipientUserId,
      deletedAt: null,
    })
    if (!recipient) {
      throw new Error('Invalid or expired link')
    }

    accessToken.usedAt = new Date()
    accessToken.useCount += 1
    let becameRead = false
    if (recipient.status === 'unread') {
      recipient.status = 'read'
      recipient.readAt = new Date()
      becameRead = true
    }
    await em.flush()
    if (becameRead) {
      await emitMessagesEvent(
        'messages.message.read',
        {
          messageId: message.id,
          recipientUserId: accessToken.recipientUserId,
          userId: accessToken.recipientUserId,
          source: 'token',
          tenantId: message.tenantId,
          organizationId: message.organizationId ?? null,
        },
        { persistent: true },
      )
    }

    return {
      messageId: message.id,
      recipientUserId: accessToken.recipientUserId,
    }
  },
}

registerCommand(consumeTokenCommand)
