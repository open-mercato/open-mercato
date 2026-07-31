import '@open-mercato/core/modules/messages/commands/actions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { registerMessageTypes } from '@open-mercato/core/modules/messages/lib/message-types-registry'

describe('messages.actions.execute command', () => {
  beforeAll(() => {
    // Opt `demo.approve` into the message-action allowlist so the concurrency
    // test below exercises the claim path rather than being short-circuited by
    // the confused-deputy guard.
    registerMessageTypes([
      {
        type: 'demo.approval',
        module: 'demo',
        labelKey: 'demo.approval',
        icon: 'bell',
        defaultActions: [{ id: 'approve', label: 'Approve', commandId: 'demo.approve' }],
      },
    ])
  })

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
      nativeUpdate: jest.fn(async () => 1),
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

  it('does not run the target command when the terminal action is claimed concurrently', async () => {
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
            id: 'approve',
            label: 'Approve',
            commandId: 'demo.approve',
            isTerminal: true,
          },
        ],
      },
    }

    // Simulate a concurrent request that wins the atomic claim between our read
    // and our own claim attempt: the compare-and-set UPDATE then matches 0 rows.
    let winnerClaimed = false
    const emFork = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Message) {
          return winnerClaimed
            ? { ...message, actionTaken: 'approve', actionTakenByUserId: 'other-user' }
            : message
        }
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
      nativeUpdate: jest.fn(async () => {
        winnerClaimed = true
        return 0
      }),
    }

    const nestedCommandBus = {
      execute: jest.fn(async () => ({ result: { ok: true }, logEntry: null })),
    }

    await expect(
      command!.execute(
        {
          messageId: message.id,
          actionId: 'approve',
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
      ),
    ).rejects.toThrow('Action already taken')

    // The atomic claim must run before the target command...
    expect(emFork.nativeUpdate).toHaveBeenCalledTimes(1)
    // ...and because the claim lost the race, the target command never executed.
    expect(nestedCommandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses a composer-controlled commandId that no message type declares', async () => {
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
            // Innocuous label, but the commandId targets an arbitrary registered
            // command — the confused-deputy vector from issue #3488.
            id: 'acknowledge',
            label: 'Acknowledge',
            commandId: 'auth.users.delete',
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
      nativeUpdate: jest.fn(async () => 1),
    }

    const nestedCommandBus = {
      execute: jest.fn(async () => ({ result: { ok: true }, logEntry: null })),
    }

    await expect(
      command!.execute(
        {
          messageId: message.id,
          actionId: 'acknowledge',
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
      ),
    ).rejects.toThrow('Action command is not allowed')

    // The disallowed command must never reach the bus, and no terminal claim
    // should have been reserved (guard runs before the claim).
    expect(nestedCommandBus.execute).not.toHaveBeenCalled()
    expect(emFork.nativeUpdate).not.toHaveBeenCalled()
  })
})
