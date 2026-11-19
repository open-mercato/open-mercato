const enqueueMock = jest.fn(async () => 'job-id')
const commandExecuteMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `translated:${key}` }),
}))

jest.mock('../mutation-guards', () => ({
  ...jest.requireActual('../mutation-guards'),
  guardOutboundCreate: jest.fn(async () => undefined),
}))

jest.mock('../queue', () => ({
  ...jest.requireActual('../queue'),
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { findSendSeparatelyCopyFields, sendAsUser } from '../send-as-user'
import { CommunicationChannel, MessageChannelLink } from '../../data/entities'
import { MessageExternalParticipant } from '../../../messages/data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const actor = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }

function makeContainer() {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em = {
    fork: jest.fn(),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const record = { id: `row-${created.length + 1}`, ...data }
      created.push({ entity, data: record })
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (callback: () => Promise<void>) => callback()),
  }
  em.fork.mockReturnValue(em)
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return { execute: commandExecuteMock }
      throw new Error(`unexpected resolve: ${name}`)
    },
  }
  return { container: container as never, created }
}

function primeChannel() {
  mockFindOne.mockImplementation(async (_em, entity) => (
    entity === CommunicationChannel
      ? { id: 'ch-1', userId: 'user-1', isActive: true, status: 'connected', providerKey: 'imap', channelType: 'email' }
      : null
  ) as never)
}

const baseInput = {
  userChannelId: 'ch-1',
  subject: 'Hello',
  body: { plain: 'Hi' },
}

describe('findSendSeparatelyCopyFields', () => {
  it('flags cc and bcc only for a separate send to several recipients', () => {
    expect(findSendSeparatelyCopyFields({ to: ['a@x.io', 'b@x.io'], cc: ['c@x.io'], bcc: ['d@x.io'], sendSeparately: true })).toEqual(['cc', 'bcc'])
    expect(findSendSeparatelyCopyFields({ to: ['a@x.io', 'b@x.io'], bcc: ['d@x.io'], sendSeparately: true })).toEqual(['bcc'])
    expect(findSendSeparatelyCopyFields({ to: ['a@x.io'], cc: ['c@x.io'], sendSeparately: true })).toEqual([])
    expect(findSendSeparatelyCopyFields({ to: ['a@x.io', 'b@x.io'], cc: ['c@x.io'] })).toEqual([])
  })
})

describe('sendAsUser — recipients', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    commandExecuteMock.mockReset()
    commandExecuteMock.mockResolvedValue({ result: { id: 'msg-1', threadId: 'thread-1' } })
    mockFindOne.mockReset()
    mockFind.mockReset()
    primeChannel()
  })

  it('refuses a separate send with copies before composing anything', async () => {
    const { container } = makeContainer()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com'],
      sendSeparately: true,
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'translated:messages.errors.sendSeparatelyWithCopies',
      fieldErrors: { cc: 'translated:messages.errors.sendSeparatelyWithCopies' },
    })
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('passes every addressee with its role to compose and creates one joint link', async () => {
    const { container, created } = makeContainer()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
    })

    expect(result).toMatchObject({ ok: true, messageId: 'msg-1' })
    const composeInput = commandExecuteMock.mock.calls[0][1].input
    expect(composeInput.externalEmail).toBe('a@example.com')
    expect(composeInput.sendSeparately).toBe(false)
    expect(composeInput.externalParticipants).toEqual([
      { email: 'a@example.com', role: 'to' },
      { email: 'b@example.com', role: 'to' },
      { email: 'c@example.com', role: 'cc' },
      { email: 'd@example.com', role: 'bcc' },
    ])
    const links = created.filter((row) => row.entity === MessageChannelLink).map((row) => row.data)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ externalParticipantId: null, channelMetadata: expect.objectContaining({ to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'] }) })
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).not.toHaveProperty('externalParticipantId')
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('creates one link and one delivery job per "to" participant for a separate send', async () => {
    mockFind.mockImplementation(async (_em, entity) => (
      entity === MessageExternalParticipant
        ? [
            { id: 'p-a', role: 'to', email: 'a@example.com' },
            { id: 'p-b', role: 'to', email: 'b@example.com' },
          ]
        : []
    ) as never)
    const { container, created } = makeContainer()

    await sendAsUser(container, actor, {
      ...baseInput,
      to: ['a@example.com', 'b@example.com'],
      sendSeparately: true,
    })

    expect(commandExecuteMock.mock.calls[0][1].input.sendSeparately).toBe(true)
    expect(mockFind.mock.calls[0][2]).toEqual({ messageId: 'msg-1', role: 'to', tenantId: 'tenant-1', organizationId: 'org-1' })
    const links = created.filter((row) => row.entity === MessageChannelLink).map((row) => row.data)
    expect(links).toEqual([
      expect.objectContaining({ externalParticipantId: 'p-a', channelMetadata: expect.objectContaining({ to: ['a@example.com'], cc: [], bcc: [] }) }),
      expect.objectContaining({ externalParticipantId: 'p-b', channelMetadata: expect.objectContaining({ to: ['b@example.com'], cc: [], bcc: [] }) }),
    ])
    expect(enqueueMock.mock.calls.map(([job]) => (job as { externalParticipantId?: string }).externalParticipantId)).toEqual(['p-a', 'p-b'])
  })
})
