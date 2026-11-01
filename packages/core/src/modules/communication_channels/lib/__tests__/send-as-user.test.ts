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

import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendAsUser } from '../send-as-user'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const TENANT = '550e8400-e29b-41d4-a716-446655440020'
const ORG = '550e8400-e29b-41d4-a716-446655440030'
const CHANNEL = '550e8400-e29b-41d4-a716-446655440060'
const USER = '550e8400-e29b-41d4-a716-446655440070'
const THREAD = '550e8400-e29b-41d4-a716-446655440080'
const PARENT = '550e8400-e29b-41d4-a716-446655440090'

type Row = Record<string, unknown>
type Created = { entity: unknown; data: Row }
type Store = {
  channels: Row[]
  conversations: Row[]
  mappings: Row[]
  links: Row[]
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return (expected as { $in: unknown[] }).$in.includes(row[key])
    }
    if (expected === null) return row[key] === null || row[key] === undefined
    return row[key] === expected
  })
}

function rowsFor(store: Store, entity: unknown): Row[] {
  if (entity === CommunicationChannel) return store.channels
  if (entity === ExternalConversation) return store.conversations
  if (entity === ChannelThreadMapping) return store.mappings
  if (entity === MessageChannelLink) return store.links
  throw new Error(`unexpected entity lookup: ${String(entity)}`)
}

function sortedByCreatedAt(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0))
}

function primeStore(store: Store) {
  mockFindOne.mockImplementation(async (_em, entity, where) => {
    const found = sortedByCreatedAt(rowsFor(store, entity)).find((row) => matches(row, where as Row))
    return (found ?? null) as never
  })
  mockFind.mockImplementation(async (_em, entity, where) => {
    return sortedByCreatedAt(rowsFor(store, entity)).filter((row) => matches(row, where as Row)) as never
  })
}

function makeContainer() {
  const created: Created[] = []
  const em = {
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { id: `${created.length + 1}-new`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (work: () => Promise<void>) => work()),
    fork: (): unknown => em,
  }
  const commandBus = {
    execute: jest.fn(async () => ({ result: { id: 'msg-reply', threadId: THREAD } })),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as unknown as AppContainer
  return { container, created }
}

const channel: Row = {
  id: CHANNEL,
  userId: USER,
  providerKey: 'gmail',
  channelType: 'email',
  isActive: true,
  status: 'connected',
  tenantId: TENANT,
  organizationId: ORG,
  deletedAt: null,
}

const scoped = { tenantId: TENANT, organizationId: ORG }

function conversationRow(id: string, ref: string, createdAt: number): Row {
  return { id, channelId: CHANNEL, externalConversationId: ref, subject: 'Offer', assignedUserId: USER, createdAt, ...scoped }
}

function mappingRow(conversationId: string, ref: string, createdAt: number): Row {
  return {
    id: `map-${conversationId}`,
    externalConversationId: conversationId,
    messageThreadId: THREAD,
    channelId: CHANNEL,
    externalThreadRef: ref,
    createdAt,
    ...scoped,
  }
}

const input = {
  userChannelId: CHANNEL,
  to: ['client@example.com'],
  subject: 'Re: Offer',
  body: { plain: 'Thanks' },
  parentMessageId: PARENT,
}

const actor = { userId: USER, tenantId: TENANT, organizationId: ORG }

function createdLink(created: Created[]): Row | undefined {
  return created.find((row) => row.entity === MessageChannelLink)?.data
}

describe('sendAsUser: conversation of a follow-up send', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
    mockFind.mockReset()
    enqueue.mockClear()
  })

  it('reuses the conversation the thread is already mapped to on this channel', async () => {
    const { container, created } = makeContainer()
    primeStore({
      channels: [channel],
      conversations: [conversationRow('conv-gmail', 'gmail-thread:gm-thread-1', 1)],
      mappings: [mappingRow('conv-gmail', 'gmail-thread:gm-thread-1', 1)],
      links: [],
    })

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: true, messageId: 'msg-reply', threadId: THREAD })
    expect(created.find((row) => row.entity === ExternalConversation)).toBeUndefined()
    expect(created.find((row) => row.entity === ChannelThreadMapping)).toBeUndefined()
    expect(createdLink(created)?.externalConversationId).toBe('conv-gmail')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it("joins the parent message's conversation when the thread maps to several conversations on the channel", async () => {
    const { container, created } = makeContainer()
    primeStore({
      channels: [channel],
      conversations: [
        conversationRow('conv-a', 'gmail-thread:gm-a', 1),
        conversationRow('conv-b', 'gmail-thread:gm-b', 2),
      ],
      mappings: [
        mappingRow('conv-a', 'gmail-thread:gm-a', 1),
        mappingRow('conv-b', 'gmail-thread:gm-b', 2),
      ],
      links: [{ id: 'link-parent', messageId: PARENT, externalConversationId: 'conv-b', createdAt: 2, ...scoped }],
    })

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: true })
    expect(created.find((row) => row.entity === ExternalConversation)).toBeUndefined()
    expect(created.find((row) => row.entity === ChannelThreadMapping)).toBeUndefined()
    expect(createdLink(created)?.externalConversationId).toBe('conv-b')
  })

  it("ignores the parent's links on other channels and falls back to the oldest mapping of the thread", async () => {
    const { container, created } = makeContainer()
    primeStore({
      channels: [channel],
      conversations: [
        conversationRow('conv-b', 'gmail-thread:gm-b', 2),
        conversationRow('conv-a', 'gmail-thread:gm-a', 1),
        { ...conversationRow('conv-other', 'gmail-thread:gm-x', 0), channelId: 'other-channel' },
      ],
      mappings: [
        mappingRow('conv-b', 'gmail-thread:gm-b', 2),
        mappingRow('conv-a', 'gmail-thread:gm-a', 1),
      ],
      links: [{ id: 'link-parent', messageId: PARENT, externalConversationId: 'conv-other', createdAt: 0, ...scoped }],
    })

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: true })
    expect(createdLink(created)?.externalConversationId).toBe('conv-a')
    const mappingLookup = mockFindOne.mock.calls.find(([, entity]) => entity === ChannelThreadMapping)
    expect(mappingLookup?.[3]).toEqual({ orderBy: { createdAt: 'asc' } })
  })

  it('opens an outbound placeholder conversation for a thread the channel has not seen', async () => {
    const { container, created } = makeContainer()
    primeStore({ channels: [channel], conversations: [], mappings: [], links: [] })

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: true })
    const conversation = created.find((row) => row.entity === ExternalConversation)
    expect(conversation?.data.externalConversationId).toBe(`outbound:${THREAD}`)
    const mapping = created.find((row) => row.entity === ChannelThreadMapping)
    expect(mapping?.data.externalThreadRef).toBe(`outbound:${THREAD}`)
    expect(createdLink(created)?.externalConversationId).toBe(conversation?.data.id)
  })
})
