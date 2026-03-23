import '@open-mercato/core/modules/messages/commands/actions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

describe('messages.actions.execute command', () => {
  it('surfaces terminal action log entries for href actions', async () => {
    const command = commandRegistry.get('messages.actions.execute')
    expect(command).toBeTruthy()

    const message = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'default',
      sourceEntityId: '22222222-2222-4222-8222-222222222222',
      tenantId: '55555555-5555-4555-8555-555555555555',
      organizationId: '66666666-6666-4666-8666-666666666666',
      threadId: null,
      parentMessageId: null,
      sentAt: new Date('2026-03-01T12:00:00.000Z'),
      deletedAt: null,
      actionTaken: null,
      actionData: {
        actions: [
          {
            id: 'open-link',
            label: 'Open link',
            href: '/backend/messages/{messageId}',
            isTerminal: true,
          },
        ],
      },
    }

    const emFork = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Message) return message
        if (entity === MessageRecipient) {
          return {
            id: '33333333-3333-4333-8333-333333333333',
            messageId: message.id,
            recipientUserId: '44444444-4444-4444-8444-444444444444',
            deletedAt: null,
          }
        }
        return null
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === MessageObject) return []
        return []
      }),
    }

    const terminalLogEntry = {
      id: 'log-1',
      undoToken: 'undo-1',
      commandId: 'messages.actions.record_terminal',
      createdAt: new Date('2026-03-19T10:00:00.000Z'),
    }

    const nestedCommandBus = {
      execute: jest.fn(async (commandId: string) => {
        if (commandId === 'messages.actions.record_terminal') {
          return {
            result: { ok: true },
            logEntry: terminalLogEntry,
          }
        }
        throw new Error(`Unexpected command ${commandId}`)
      }),
    }

    const result = await command!.execute(
      {
        messageId: message.id,
        actionId: 'open-link',
        tenantId: '55555555-5555-4555-8555-555555555555',
        organizationId: '66666666-6666-4666-8666-666666666666',
        userId: '44444444-4444-4444-8444-444444444444',
      },
      {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => emFork }
            if (name === 'commandBus') return nestedCommandBus
            return null
          },
        } as never,
        auth: {
          sub: '44444444-4444-4444-8444-444444444444',
          tenantId: '55555555-5555-4555-8555-555555555555',
          orgId: '66666666-6666-4666-8666-666666666666',
        } as never,
        organizationScope: null,
        selectedOrganizationId: '66666666-6666-4666-8666-666666666666',
        organizationIds: ['66666666-6666-4666-8666-666666666666'],
      },
    )

    expect(result.result).toEqual({ redirect: `/backend/messages/${message.id}` })
    expect(result.operationLogEntry).toEqual(terminalLogEntry)
    expect(nestedCommandBus.execute).toHaveBeenCalledWith(
      'messages.actions.record_terminal',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: message.id,
          actionId: 'open-link',
        }),
      }),
    )
  })
})
