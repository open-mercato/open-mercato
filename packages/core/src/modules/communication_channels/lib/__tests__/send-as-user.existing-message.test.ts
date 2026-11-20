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
import { sendAsUser, validateSenderChannel } from '../send-as-user'
import { ChannelMutationBlockedError, guardOutboundCreate } from '../mutation-guards'
import { CommunicationChannel, MessageChannelLink } from '../../data/entities'
import { Message, MessageExternalParticipant } from '../../../messages/data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockGuard = guardOutboundCreate as jest.MockedFunction<typeof guardOutboundCreate>

const actor = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const input = { userChannelId: 'ch-1', messageId: 'msg-1' }

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
    nativeUpdate: jest.fn(async () => 1),
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
  return { container: container as never, em, created }
}

function prime(options: { message?: Record<string, unknown>; linked?: boolean } = {}) {
  const message = {
    id: 'msg-1',
    threadId: 'thread-1',
    senderUserId: 'user-1',
    visibility: 'public',
    isDraft: false,
    subject: 'Quote',
    body: 'Hello **there**',
    bodyFormat: 'text',
    emailSendSeparately: false,
    ...options.message,
  }
  mockFindOne.mockImplementation(async (_em, entity) => {
    if (entity === Message) return message as never
    if (entity === MessageChannelLink) return (options.linked ? { id: 'link-0' } : null) as never
    if (entity === CommunicationChannel) {
      return { id: 'ch-1', userId: 'user-1', isActive: true, status: 'connected', providerKey: 'imap', channelType: 'email' } as never
    }
    return null as never
  })
}

function primeParticipants(participants: Array<{ id: string; role: string; email: string }>) {
  mockFind.mockImplementation(async (_em, entity) => (entity === MessageExternalParticipant ? participants : []) as never)
}

function links(created: Array<{ entity: unknown; data: Record<string, unknown> }>) {
  return created.filter((row) => row.entity === MessageChannelLink).map((row) => row.data)
}

describe('sendAsUser — existing message', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    commandExecuteMock.mockReset()
    mockFindOne.mockReset()
    mockFind.mockReset()
    mockGuard.mockReset()
    mockGuard.mockResolvedValue(undefined)
    primeParticipants([
      { id: 'p-a', role: 'to', email: 'a@example.com' },
      { id: 'p-b', role: 'to', email: 'b@example.com' },
      { id: 'p-c', role: 'cc', email: 'c@example.com' },
    ])
  })

  it('links and enqueues the message without composing a new one', async () => {
    prime()
    const { container, em, created } = makeContainer()

    const result = await sendAsUser(container, actor, input)

    expect(result).toEqual({ ok: true, messageId: 'msg-1', threadId: 'thread-1', channelId: 'ch-1', providerKey: 'imap' })
    expect(commandExecuteMock).not.toHaveBeenCalled()
    expect(links(created)).toEqual([
      expect.objectContaining({
        messageId: 'msg-1',
        externalParticipantId: null,
        direction: 'outbound',
        deliveryStatus: 'pending',
        channelPayload: { text: 'Hello **there**' },
        channelMetadata: expect.objectContaining({ to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'], bcc: [], subject: 'Quote' }),
      }),
    ])
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      Message,
      { id: 'msg-1', ...scope },
      { sourceEntityType: 'communication_channels.send_as_user', sourceEntityId: 'ch-1' },
    )
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toEqual({ messageId: 'msg-1', scope, attempt: 1 })
  })

  it('marks participants that were never queued as pending', async () => {
    prime()
    const { container, em } = makeContainer()

    await sendAsUser(container, actor, input)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      MessageExternalParticipant,
      { messageId: 'msg-1', ...scope, deliveryStatus: null },
      { deliveryStatus: 'pending' },
    )
  })

  it('creates one link and job per "to" participant for a separate send', async () => {
    prime({ message: { emailSendSeparately: true } })
    primeParticipants([
      { id: 'p-a', role: 'to', email: 'a@example.com' },
      { id: 'p-b', role: 'to', email: 'b@example.com' },
    ])
    const { container, created } = makeContainer()

    await sendAsUser(container, actor, input)

    expect(links(created)).toEqual([
      expect.objectContaining({ externalParticipantId: 'p-a', channelMetadata: expect.objectContaining({ to: ['a@example.com'], cc: [], bcc: [] }) }),
      expect.objectContaining({ externalParticipantId: 'p-b', channelMetadata: expect.objectContaining({ to: ['b@example.com'], cc: [], bcc: [] }) }),
    ])
    expect(enqueueMock.mock.calls.map(([job]) => (job as { externalParticipantId?: string }).externalParticipantId)).toEqual(['p-a', 'p-b'])
  })

  it('keeps the send-separately rule for a message with copies', async () => {
    prime({ message: { emailSendSeparately: true } })
    const { container, created } = makeContainer()

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: false, status: 400, fieldErrors: { cc: 'translated:messages.errors.sendSeparatelyWithCopies' } })
    expect(links(created)).toHaveLength(0)
  })

  it('refuses a message the actor did not author', async () => {
    prime({ message: { senderUserId: 'someone-else' } })
    const { container, created } = makeContainer()

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(links(created)).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('refuses an internal message and an unsent draft', async () => {
    prime({ message: { visibility: 'internal' } })
    await expect(sendAsUser(makeContainer().container, actor, input)).resolves.toMatchObject({ ok: false, status: 422 })
    prime({ message: { isDraft: true } })
    await expect(sendAsUser(makeContainer().container, actor, input)).resolves.toMatchObject({ ok: false, status: 409 })
  })

  it('answers 409 "already linked" when an outbound link exists', async () => {
    prime({ linked: true })
    const { container, created } = makeContainer()

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: false, status: 409, code: 'already_linked' })
    expect(links(created)).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('reports a channel that requires re-authentication as unavailable', async () => {
    prime()
    mockGuard.mockRejectedValue(new ChannelMutationBlockedError('channel_requires_reauth', 'ch-1', 'Channel requires re-authentication'))
    const { container, created } = makeContainer()

    const result = await sendAsUser(container, actor, input)

    expect(result).toMatchObject({ ok: false, status: 422, code: 'channel_unavailable' })
    expect(links(created)).toHaveLength(0)
  })
})

describe('validateSenderChannel', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
    mockGuard.mockReset()
    mockGuard.mockResolvedValue(undefined)
  })

  it('accepts an owned connected channel and refuses another user\'s', async () => {
    prime()
    await expect(validateSenderChannel(makeContainer().container, actor, 'ch-1')).resolves.toEqual({ ok: true })
    await expect(validateSenderChannel(makeContainer().container, { ...actor, userId: 'user-2' }, 'ch-1'))
      .resolves.toMatchObject({ ok: false, status: 403, code: 'channel_unavailable' })
  })
})
