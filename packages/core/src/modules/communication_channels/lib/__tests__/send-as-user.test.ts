const findOneWithDecryptionMock = jest.fn()
const enqueueMock = jest.fn(async () => 'job-1')
const guardOutboundCreateMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../mutation-guards', () => {
  class ChannelMutationBlockedError extends Error {
    errors = {}
  }
  return {
    ChannelMutationBlockedError,
    guardOutboundCreate: (...args: unknown[]) => guardOutboundCreateMock(...args),
  }
})

jest.mock('../queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'communication-channels-outbound' },
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

import { sendAsUser } from '../send-as-user'

describe('sendAsUser delivery routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        providerKey: 'gmail',
        channelType: 'email',
        isActive: true,
        status: 'connected',
      })
      .mockResolvedValueOnce({
        id: '66666666-6666-4666-8666-666666666666',
        subject: 'Existing conversation',
        assignedUserId: '22222222-2222-4222-8222-222222222222',
        lastMessageAt: new Date(),
      })
      .mockResolvedValueOnce({ id: '77777777-7777-4777-8777-777777777777' })
  })

  it('persists authored intent as non-email and enqueues exactly one channel delivery', async () => {
    const em: any = {
      fork: jest.fn(),
      transactional: jest.fn(),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'created-1', ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
    }
    em.fork.mockReturnValue(em)
    em.transactional.mockImplementation(async (callback: () => Promise<void>) => callback())
    const commandBus = {
      execute: jest.fn(async () => ({
        result: {
          id: '44444444-4444-4444-8444-444444444444',
          threadId: '55555555-5555-4555-8555-555555555555',
        },
      })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        throw new Error(`Unknown dependency: ${name}`)
      },
    }

    const result = await sendAsUser(container as never, {
      userId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      organizationId: '88888888-8888-4888-8888-888888888888',
    }, {
      userChannelId: '11111111-1111-4111-8111-111111111111',
      to: ['customer@example.com'],
      subject: 'Outbound subject',
      body: { plain: 'Outbound body' },
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({
        input: expect.objectContaining({
          visibility: 'public',
          sendViaEmail: false,
          externalEmail: 'customer@example.com',
        }),
      }),
    )
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '44444444-4444-4444-8444-444444444444',
      attempt: 1,
    }))
  })
})
