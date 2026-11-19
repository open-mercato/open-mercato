jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn(async (input: { credentials: Record<string, unknown> }) => ({
    refreshed: false,
    credentials: input.credentials,
  })),
}))

jest.mock('../../lib/thread-token', () => ({
  getOrCreateThreadToken: jest.fn(async () => ({ token: 'tok-1' })),
  buildBodyFooter: jest.fn(() => ({ html: '', plain: '' })),
  buildReferencesId: jest.fn((token: string) => `<om-${token}>`),
}))

import deliverOutboundMessageCommand, { splitParticipantsByDeliveryResult } from '../deliver-outbound-message'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageExternalParticipant } from '../../../messages/data/entities'
import { MessageChannelLink } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const MSG = '550e8400-e29b-41d4-a716-446655440010'
const TENANT = '550e8400-e29b-41d4-a716-446655440020'
const ORG = '550e8400-e29b-41d4-a716-446655440030'
const PARTICIPANT_B = '550e8400-e29b-41d4-a716-446655440042'

type SendResult = { status: string; externalMessageId?: string; error?: string; metadata?: Record<string, unknown> }

const participants = [
  { id: 'p-a', role: 'to', email: 'a@example.com' },
  { id: 'p-b', role: 'to', email: 'b@example.com' },
  { id: 'p-c', role: 'cc', email: 'c@example.com' },
  { id: 'p-d', role: 'bcc', email: 'd@example.com' },
]

function makeCtx(sendResult: SendResult) {
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 1),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const adapter = {
    providerKey: 'imap',
    convertOutbound: jest.fn(async (input: { channelMetadata: Record<string, unknown> }) => ({
      content: { raw: 'x' },
      metadata: input.channelMetadata,
    })),
    sendMessage: jest.fn(async () => sendResult),
  }
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        if (name === 'integrationLogService') return { error: jest.fn() }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  } as never
  return { ctx, em, adapter }
}

function primeFinds(link: Record<string, unknown>, linkParticipants: Array<Record<string, unknown>>) {
  mockFindOne.mockReset()
  mockFindOne
    .mockResolvedValueOnce({ id: MSG, threadId: 'thread-1', body: 'hello', bodyFormat: 'text' } as never)
    .mockResolvedValueOnce(link as never)
    .mockResolvedValueOnce({
      messageThreadId: 'thread-1',
      channelId: 'ch-1',
      externalConversationId: 'conv-1',
      externalThreadRef: 'outbound:thread-1',
    } as never)
    .mockResolvedValueOnce({
      id: 'ch-1',
      isActive: true,
      providerKey: 'imap',
      channelType: 'email',
      userId: 'u-1',
      credentialsRef: null,
      status: 'connected',
    } as never)
  mockFind.mockReset()
  mockFind.mockResolvedValueOnce(linkParticipants as never).mockResolvedValue([] as never)
}

function participantUpdates(em: ReturnType<typeof makeCtx>['em']) {
  return em.nativeUpdate.mock.calls.filter(([entity]) => entity === MessageExternalParticipant)
}

describe('splitParticipantsByDeliveryResult', () => {
  it('fails only the participants the relay rejected, case-insensitively', () => {
    const result = splitParticipantsByDeliveryResult(participants, {
      accepted: ['a@example.com'],
      rejected: [{ address: 'B@Example.com' }],
    })
    expect(result.sent.map((participant) => participant.id)).toEqual(['p-a', 'p-c', 'p-d'])
    expect(result.rejected.map((participant) => participant.id)).toEqual(['p-b'])
  })

  it('marks every participant sent when the provider accepts the whole message', () => {
    const result = splitParticipantsByDeliveryResult(participants, undefined)
    expect(result.sent).toHaveLength(4)
    expect(result.rejected).toHaveLength(0)
  })
})

describe('deliverOutboundMessageCommand — participants', () => {
  it('addresses a joint link from all participants and records a partial rejection per participant', async () => {
    const link: Record<string, unknown> = {
      id: 'link-1',
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi', to: ['stale@example.com'], bcc: ['d@example.com'] },
    }
    const { ctx, em, adapter } = makeCtx({
      status: 'failed',
      externalMessageId: 'smtp-1',
      error: 'SMTP_SEND_PARTIALLY_REJECTED: relay rejected b@example.com',
      metadata: { accepted: ['a@example.com', 'c@example.com', 'd@example.com'], rejected: ['b@example.com'] },
    })
    primeFinds(link, participants)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } },
      ctx,
    )

    expect(result).toMatchObject({ status: 'delivered', channelLinkId: 'link-1' })
    expect(mockFindOne.mock.calls[1][1]).toBe(MessageChannelLink)
    expect(mockFindOne.mock.calls[1][2]).toEqual({ messageId: MSG, externalParticipantId: null, tenantId: TENANT, organizationId: ORG })
    expect(mockFind.mock.calls[0][2]).toEqual({ messageId: MSG, tenantId: TENANT, organizationId: ORG })
    expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channelMetadata: expect.objectContaining({
        to: ['a@example.com', 'b@example.com'],
        cc: ['c@example.com'],
        bcc: ['d@example.com'],
      }),
    }))
    expect(link.deliveryStatus).toBe('sent')
    const stored = link.channelMetadata as Record<string, unknown>
    expect(stored.to).toEqual(['a@example.com', 'b@example.com'])
    expect(stored.cc).toEqual(['c@example.com'])
    expect(stored).not.toHaveProperty('bcc')

    const updates = participantUpdates(em)
    expect(updates).toHaveLength(2)
    expect(updates[0][1]).toMatchObject({ id: { $in: ['p-a', 'p-c', 'p-d'] } })
    expect(updates[0][2]).toMatchObject({ deliveryStatus: 'sent', deliveryError: null })
    expect(updates[1][1]).toMatchObject({ id: { $in: ['p-b'] } })
    expect(updates[1][2]).toMatchObject({ deliveryStatus: 'failed' })
    const summary = em.nativeUpdate.mock.calls.find(([entity]) => entity === Message)
    expect(summary?.[1]).toMatchObject({ id: MSG, externalEmailSentAt: null })
    expect(summary?.[2]).toMatchObject({ externalEmailFailedAt: null })
  })

  it('delivers a separate link to its own participant only', async () => {
    const link: Record<string, unknown> = {
      id: 'link-b',
      externalParticipantId: PARTICIPANT_B,
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi', to: ['b@example.com'], cc: [], bcc: [] },
    }
    const { ctx, em, adapter } = makeCtx({ status: 'sent', externalMessageId: 'gmail-1' })
    primeFinds(link, [{ id: PARTICIPANT_B, role: 'to', email: 'b@example.com' }])

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG }, externalParticipantId: PARTICIPANT_B },
      ctx,
    )

    expect(result).toMatchObject({ status: 'delivered', channelLinkId: 'link-b' })
    expect(mockFindOne.mock.calls[1][2]).toEqual({ messageId: MSG, externalParticipantId: PARTICIPANT_B, tenantId: TENANT, organizationId: ORG })
    expect(mockFind.mock.calls[0][2]).toEqual({ messageId: MSG, tenantId: TENANT, organizationId: ORG, id: PARTICIPANT_B })
    expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channelMetadata: expect.objectContaining({ to: ['b@example.com'], cc: [], bcc: [] }),
    }))
    const updates = participantUpdates(em)
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toMatchObject({ id: { $in: [PARTICIPANT_B] } })
    expect(updates[0][2]).toMatchObject({ deliveryStatus: 'sent' })
  })

  it('creates the separate link for its participant when none exists yet', async () => {
    const { ctx, em } = makeCtx({ status: 'sent', externalMessageId: 'gmail-2' })
    primeFinds(null as never, [{ id: PARTICIPANT_B, role: 'to', email: 'b@example.com' }])

    await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG }, externalParticipantId: PARTICIPANT_B },
      ctx,
    )

    const createdLink = em.create.mock.calls.find(([entity]) => entity === MessageChannelLink)
    expect(createdLink?.[1]).toMatchObject({ messageId: MSG, externalParticipantId: PARTICIPANT_B, deliveryStatus: 'pending' })
  })

  it('keeps participants pending with the error when the whole send fails', async () => {
    const link: Record<string, unknown> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: { subject: 'Hi' } }
    const { ctx, em } = makeCtx({ status: 'failed', error: 'SMTP_SEND_FAILED: connection refused' })
    primeFinds(link, participants)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } },
      ctx,
    )

    expect(result).toMatchObject({ status: 'failed' })
    expect(link.deliveryStatus).toBe('failed')
    const updates = participantUpdates(em)
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toMatchObject({ id: { $in: ['p-a', 'p-b', 'p-c', 'p-d'] }, deliveryStatus: 'pending' })
    expect(updates[0][2]).toEqual({ deliveryError: expect.stringContaining('connection refused') })
    const summary = em.nativeUpdate.mock.calls.find(([entity]) => entity === Message)
    expect(summary?.[2]).toMatchObject({ externalEmailError: expect.stringContaining('connection refused') })
  })

  it('keeps the link recipients for a legacy message without participants', async () => {
    const link: Record<string, unknown> = {
      id: 'link-1',
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi', to: ['legacy@example.com'], bcc: ['hidden@example.com'] },
    }
    const { ctx, em, adapter } = makeCtx({ status: 'sent', externalMessageId: 'gmail-3' })
    primeFinds(link, [])

    await deliverOutboundMessageCommand.execute({ messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } }, ctx)

    expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channelMetadata: expect.objectContaining({ to: ['legacy@example.com'], bcc: ['hidden@example.com'] }),
    }))
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })
})
