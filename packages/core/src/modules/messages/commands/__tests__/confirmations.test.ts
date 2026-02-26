import '@open-mercato/core/modules/messages/commands/confirmations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageConfirmation, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

describe('messages.confirmations.confirm command', () => {
  it('creates confirmation when missing', async () => {
    const command = commandRegistry.get('messages.confirmations.confirm')
    expect(command).toBeTruthy()

    const createdAt = new Date('2026-02-15T12:00:00.000Z')
    const emFork = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Message) {
          return {
            id: '11111111-1111-4111-8111-111111111111',
            senderUserId: '44444444-4444-4444-8444-444444444444',
            tenantId: '22222222-2222-4222-8222-222222222222',
            organizationId: '33333333-3333-4333-8333-333333333333',
            deletedAt: null,
          }
        }
        if (entity === MessageRecipient) return null
        if (entity === MessageConfirmation) return null
        return null
      }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
        confirmedAt: createdAt,
      })),
      persistAndFlush: jest.fn(async () => {}),
    }

    const result = await command!.execute(
      {
        messageId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        confirmed: true,
      },
      {
        container: { resolve: () => ({ fork: () => emFork }) } as never,
        auth: { sub: '44444444-4444-4444-8444-444444444444', tenantId: '22222222-2222-4222-8222-222222222222' } as never,
        organizationScope: null,
        selectedOrganizationId: '33333333-3333-4333-8333-333333333333',
        organizationIds: ['33333333-3333-4333-8333-333333333333'],
      },
    )

    expect(emFork.create).toHaveBeenCalledTimes(1)
    expect(emFork.persistAndFlush).toHaveBeenCalledTimes(1)
    expect(result.messageId).toBe('11111111-1111-4111-8111-111111111111')
    expect(result.confirmed).toBe(true)
    expect(result.confirmedByUserId).toBe('44444444-4444-4444-8444-444444444444')
  })
})
