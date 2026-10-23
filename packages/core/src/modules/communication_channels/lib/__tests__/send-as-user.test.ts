jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../mutation-guards', () => {
  class ChannelMutationBlockedError extends Error {
    errors: Record<string, string> = {}
  }
  return {
    ChannelMutationBlockedError,
    guardOutboundCreate: jest.fn(async () => undefined),
  }
})

const enqueue = jest.fn(async () => undefined)
jest.mock('../queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'communication-channels-outbound' },
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue })),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendAsUser } from '../send-as-user'
import { ChannelThreadMapping, ExternalConversation, MessageChannelLink } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const TENANT = '550e8400-e29b-41d4-a716-446655440020'
const ORG = '550e8400-e29b-41d4-a716-446655440030'
const CHANNEL = '550e8400-e29b-41d4-a716-446655440060'
const USER = '550e8400-e29b-41d4-a716-446655440070'
const THREAD = '550e8400-e29b-41d4-a716-446655440080'

type Created = { entity: unknown; data: Record<string, unknown> }

function makeContainer() {
  const created: Created[] = []
  const em: any = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `${created.length + 1}-new`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (work: () => Promise<void>) => work()),
  }
  em.fork = () => em
  const commandBus = {
    execute: jest.fn(async () => ({ result: { id: 'msg-reply', threadId: THREAD } })),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as any
  return { container, created }
}

const channel = {
  id: CHANNEL,
  userId: USER,
  providerKey: 'gmail',
  channelType: 'email',
  isActive: true,
  status: 'connected',
}

const input = {
  userChannelId: CHANNEL,
  to: ['client@example.com'],
  subject: 'Re: Offer',
  body: { plain: 'Thanks' },
  parentMessageId: '550e8400-e29b-41d4-a716-446655440090',
}

describe('sendAsUser: conversation of a follow-up send', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
    enqueue.mockClear()
  })

  it('reuses the conversation the thread is already mapped to on this channel', async () => {
    const { container, created } = makeContainer()
    const providerConversation = {
      id: 'conv-gmail',
      channelId: CHANNEL,
      externalConversationId: 'gmail-thread:gm-thread-1',
      subject: 'Offer',
      assignedUserId: USER,
    }
    mockFindOne
      .mockResolvedValueOnce(channel as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ externalConversationId: 'conv-gmail', messageThreadId: THREAD } as never)
      .mockResolvedValueOnce(providerConversation as never)
      .mockResolvedValueOnce({ id: 'mapping-1', externalConversationId: 'conv-gmail' } as never)

    const result = await sendAsUser(container, { userId: USER, tenantId: TENANT, organizationId: ORG }, input)

    expect(result).toMatchObject({ ok: true, messageId: 'msg-reply', threadId: THREAD })
    expect(mockFindOne.mock.calls[2][1]).toBe(ChannelThreadMapping)
    expect(mockFindOne.mock.calls[2][2]).toMatchObject({ messageThreadId: THREAD, channelId: CHANNEL })
    expect(created.find((row) => row.entity === ExternalConversation)).toBeUndefined()
    expect(created.find((row) => row.entity === ChannelThreadMapping)).toBeUndefined()
    const link = created.find((row) => row.entity === MessageChannelLink)
    expect(link?.data.externalConversationId).toBe('conv-gmail')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('opens an outbound placeholder conversation for a thread the channel has not seen', async () => {
    const { container, created } = makeContainer()
    mockFindOne
      .mockResolvedValueOnce(channel as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)

    const result = await sendAsUser(container, { userId: USER, tenantId: TENANT, organizationId: ORG }, input)

    expect(result).toMatchObject({ ok: true })
    const conversation = created.find((row) => row.entity === ExternalConversation)
    expect(conversation?.data.externalConversationId).toBe(`outbound:${THREAD}`)
    const mapping = created.find((row) => row.entity === ChannelThreadMapping)
    expect(mapping?.data.externalThreadRef).toBe(`outbound:${THREAD}`)
  })
})
