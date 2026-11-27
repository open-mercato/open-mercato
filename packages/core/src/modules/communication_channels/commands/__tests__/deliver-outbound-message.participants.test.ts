jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

const emitMessagesEventMock = jest.fn(async () => undefined)
jest.mock('../../../messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  withAdvisoryXactLock: (em: unknown, _key: string, fn: (tx: unknown) => Promise<unknown>) => fn(em),
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

import deliverOutboundMessageCommand, { planParticipantFailure, planRejectedParticipants, splitParticipantsByDeliveryResult } from '../deliver-outbound-message'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageExternalParticipant } from '../../../messages/data/entities'
import { MessageChannelLink } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const MSG = '550e8400-e29b-41d4-a716-446655440010'
const TENANT = '550e8400-e29b-41d4-a716-446655440020'
const ORG = '550e8400-e29b-41d4-a716-446655440030'
const PARTICIPANT_B = '550e8400-e29b-41d4-a716-446655440042'

type SendResult = { status: string; externalMessageId?: string; error?: string; metadata?: Record<string, unknown>; transient?: boolean; retryAt?: Date }

const participants = [
  { id: 'p-a', role: 'to', email: 'a@example.com' },
  { id: 'p-b', role: 'to', email: 'b@example.com' },
  { id: 'p-c', role: 'cc', email: 'c@example.com' },
  { id: 'p-d', role: 'bcc', email: 'd@example.com' },
]

function makeCtx(sendResult: SendResult, options: { claimed?: number; settledCount?: number; pendingAfter?: number } = {}) {
  let claimDone = false
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (_entity: unknown, _where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (!claimDone && data.nextAttemptAt instanceof Date && data.deliveryStatus === undefined) {
        claimDone = true
        return options.claimed ?? 1
      }
      return 1
    }),
    count: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      where.deliveryStatus === 'pending' ? (options.pendingAfter ?? 0) : (options.settledCount ?? 0)),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const adapter = {
    providerKey: 'imap',
    capabilities: {},
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

function primeFinds(link: Record<string, unknown> | null, linkParticipants: Array<Record<string, unknown>>) {
  // Routing (`resolveOutboundRouting`) needs an outbound link on the mapped conversation.
  if (link) Object.assign(link, { direction: 'outbound', externalConversationId: 'conv-1', providerKey: 'imap', channelType: 'email', ...link })
  const mapping = {
    messageThreadId: 'thread-1',
    channelId: 'ch-1',
    providerKey: 'imap',
    externalConversationId: 'conv-1',
    externalThreadRef: 'outbound:thread-1',
  }
  mockFindOne.mockReset()
  mockFindOne
    .mockResolvedValueOnce({ id: MSG, threadId: 'thread-1', body: 'hello', bodyFormat: 'text' } as never)
    .mockResolvedValueOnce(link as never)
  if (link) mockFindOne.mockResolvedValueOnce(mapping as never)
  mockFindOne
    .mockResolvedValueOnce({ id: 'conv-1', channelId: 'ch-1', externalConversationId: 'outbound:thread-1' } as never)
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
  if (!link) mockFind.mockResolvedValueOnce([mapping] as never)
  mockFind.mockResolvedValueOnce(linkParticipants as never).mockResolvedValue([] as never)
}

function participantUpdates(em: ReturnType<typeof makeCtx>['em']) {
  return em.nativeUpdate.mock.calls.filter(([entity]) => entity === MessageExternalParticipant).slice(1)
}

function claimCall(em: ReturnType<typeof makeCtx>['em']) {
  return em.nativeUpdate.mock.calls.find(([entity]) => entity === MessageExternalParticipant)
}

beforeEach(() => {
  emitMessagesEventMock.mockClear()
})

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

describe('planRejectedParticipants', () => {
  const now = new Date('2026-11-25T10:00:00Z')
  const rejected = [
    { id: 'p-b', email: 'b@example.com' },
    { id: 'p-c', email: 'C@Example.com' },
  ]

  it('retries a temporarily refused recipient and fails a permanently refused one', () => {
    const retryAt = new Date('2026-11-25T10:05:00Z')
    const plan = planRejectedParticipants(
      rejected,
      { error: 'relay rejected', transientAddresses: new Set(['c@example.com']), messageSentAt: now, retryAt },
      now,
    )
    expect(plan.failed).toEqual([{ id: 'p-b', error: 'relay rejected' }])
    expect(plan.retry).toEqual([{ id: 'p-c', error: 'relay rejected', nextAttemptAt: retryAt }])
  })

  it('fails a temporarily refused recipient once the delivery window is over', () => {
    const plan = planRejectedParticipants(
      rejected,
      { error: 'relay rejected', transientAddresses: new Set(['b@example.com', 'c@example.com']), messageSentAt: new Date('2026-11-20T10:00:00Z') },
      now,
    )
    expect(plan.retry).toBeUndefined()
    expect(plan.failed?.map((entry) => entry.id)).toEqual(['p-b', 'p-c'])
  })
})

describe('deliverOutboundMessageCommand — participants', () => {
  it('keeps the link pending while a temporarily refused recipient awaits its retry', async () => {
    const link: Record<string, unknown> = {
      id: 'link-1',
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi' },
    }
    const { ctx, em } = makeCtx({
      status: 'failed',
      externalMessageId: 'smtp-1',
      error: 'SMTP_SEND_PARTIALLY_REJECTED: relay rejected 1 of 4 recipients',
      metadata: {
        accepted: ['a@example.com', 'c@example.com', 'd@example.com'],
        rejected: ['b@example.com'],
        rejectedTransient: ['b@example.com'],
      },
    })
    primeFinds(link, participants)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } },
      ctx,
    )

    expect(result).toMatchObject({ status: 'delivered', channelLinkId: 'link-1' })
    expect(link.deliveryStatus).toBe('pending')
    const updates = participantUpdates(em)
    expect(updates[0][2]).toMatchObject({ deliveryStatus: 'sent' })
    const retry = updates.find(([, where]) => (where as { id?: unknown }).id === 'p-b')
    expect(retry?.[2]).toMatchObject({ nextAttemptAt: expect.any(Date) })
    expect(retry?.[2]).not.toMatchObject({ deliveryStatus: 'failed' })
  })

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
    const claim = claimCall(em)
    expect(claim?.[1]).toMatchObject({ messageId: MSG, tenantId: TENANT, organizationId: ORG, deliveryStatus: 'pending' })
    const claimUntil = claim?.[2].nextAttemptAt
    expect(mockFind.mock.calls[0][2]).toEqual({ messageId: MSG, tenantId: TENANT, organizationId: ORG, deliveryStatus: 'pending', nextAttemptAt: claimUntil })
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
    expect(updates[0][1]).toMatchObject({ id: { $in: ['p-a', 'p-c', 'p-d'] }, nextAttemptAt: claimUntil })
    expect(updates[0][2]).toMatchObject({ deliveryStatus: 'sent', deliveryError: null })
    expect(updates[1][1]).toMatchObject({ id: 'p-b', nextAttemptAt: claimUntil })
    expect(updates[1][2]).toMatchObject({ deliveryStatus: 'failed' })
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.delivery_finished',
      expect.objectContaining({ messageId: MSG, tenantId: TENANT, organizationId: ORG }),
      { persistent: true },
    )
    const summary = em.nativeUpdate.mock.calls.find(([entity]) => entity === Message)
    expect(summary?.[1]).toMatchObject({ id: MSG, externalEmailSentAt: null })
    expect(summary?.[2]).toMatchObject({ externalEmailFailedAt: null })
  })

  it('retries a joint link for the refused cc recipient alone once To was accepted', async () => {
    const link: Record<string, unknown> = {
      id: 'link-1',
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi', to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'] },
    }
    const { ctx, em, adapter } = makeCtx({ status: 'sent', externalMessageId: 'smtp-2', metadata: { accepted: ['c@example.com'] } })
    primeFinds(link, [{ id: 'p-c', role: 'cc', email: 'c@example.com' }])

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } },
      ctx,
    )

    expect(result).toMatchObject({ status: 'delivered', channelLinkId: 'link-1' })
    expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channelMetadata: expect.objectContaining({ to: [], cc: ['c@example.com'], bcc: [] }),
    }))
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(link.deliveryStatus).toBe('sent')
    const updates = participantUpdates(em)
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toMatchObject({ id: { $in: ['p-c'] } })
    expect(updates[0][2]).toMatchObject({ deliveryStatus: 'sent' })
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
    expect(mockFind.mock.calls[0][2]).toMatchObject({ messageId: MSG, tenantId: TENANT, organizationId: ORG, id: PARTICIPANT_B, deliveryStatus: 'pending' })
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
    primeFinds(null, [{ id: PARTICIPANT_B, role: 'to', email: 'b@example.com' }])

    await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG }, externalParticipantId: PARTICIPANT_B },
      ctx,
    )

    const createdLink = em.create.mock.calls.find(([entity]) => entity === MessageChannelLink)
    expect(createdLink?.[1]).toMatchObject({ messageId: MSG, externalParticipantId: PARTICIPANT_B, deliveryStatus: 'pending' })
  })

  it('keeps participants pending with a retry time when the whole send fails transiently', async () => {
    const link: Record<string, unknown> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: { subject: 'Hi' } }
    const { ctx, em } = makeCtx({ status: 'failed', error: 'SMTP_SEND_FAILED: connect ECONNREFUSED' }, { pendingAfter: 4 })
    primeFinds(link, participants)

    const before = Date.now()
    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG }, transientRetryDelayMs: 2000 },
      ctx,
    )

    expect(result).toMatchObject({ status: 'failed', transient: true })
    expect(link.deliveryStatus).toBe('pending')
    const updates = participantUpdates(em)
    expect(updates).toHaveLength(4)
    expect(updates[0][2]).toEqual({ deliveryStatus: 'pending', deliveryError: expect.stringContaining('ECONNREFUSED'), nextAttemptAt: expect.any(Date) })
    const nextAttemptAt = (updates[0][2].nextAttemptAt as Date).getTime()
    expect(nextAttemptAt).toBeGreaterThanOrEqual(before + 2000)
    const delivery = (result as { participantDelivery?: { nextAttemptAt: string | null } }).participantDelivery
    expect(Date.parse(delivery?.nextAttemptAt ?? '')).toBe(nextAttemptAt)
    expect(em.nativeUpdate.mock.calls.some(([entity]) => entity === Message)).toBe(false)
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })

  it('fails every participant on a permanent error and records the failure summary', async () => {
    const link: Record<string, unknown> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: { subject: 'Hi' } }
    const { ctx, em } = makeCtx({ status: 'failed', error: 'SMTP_SEND_FAILED: 550 5.1.1 unknown user' })
    primeFinds(link, participants)

    const result = await deliverOutboundMessageCommand.execute({ messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } }, ctx)

    expect(result).toMatchObject({ status: 'failed', transient: false, participantDelivery: { nextAttemptAt: null } })
    expect(link.deliveryStatus).toBe('failed')
    expect(participantUpdates(em).map(([, , data]) => data.deliveryStatus)).toEqual(['failed', 'failed', 'failed', 'failed'])
    const summary = em.nativeUpdate.mock.calls.find(([entity]) => entity === Message)
    expect(summary?.[2]).toMatchObject({ externalEmailError: expect.stringContaining('550') })
  })

  it('uses the retry time the provider asked for', async () => {
    const retryAt = new Date(Date.now() + 3_600_000)
    const link: Record<string, unknown> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: { subject: 'Hi' } }
    const { ctx, em } = makeCtx({ status: 'failed', error: 'rate limited', transient: true, retryAt } as SendResult, { pendingAfter: 4 })
    primeFinds(link, participants)

    await deliverOutboundMessageCommand.execute({ messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } }, ctx)

    expect(participantUpdates(em)[0][2]).toMatchObject({ nextAttemptAt: retryAt })
  })

  it('skips a link whose participants are all settled or held by another delivery', async () => {
    const link: Record<string, unknown> = { id: 'link-1', deliveryStatus: 'failed', channelPayload: null, channelMetadata: { subject: 'Hi' } }
    const { ctx, adapter } = makeCtx({ status: 'sent', externalMessageId: 'x' }, { claimed: 0, settledCount: 2 })
    primeFinds(link, participants)

    const result = await deliverOutboundMessageCommand.execute({ messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } }, ctx)

    expect(result).toEqual({ status: 'not_due', messageId: MSG, channelLinkId: 'link-1' })
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the link recipients for a legacy message without participants', async () => {
    const link: Record<string, unknown> = {
      id: 'link-1',
      deliveryStatus: 'pending',
      channelPayload: null,
      channelMetadata: { subject: 'Hi', to: ['legacy@example.com'], bcc: ['hidden@example.com'] },
    }
    const { ctx, em, adapter } = makeCtx({ status: 'sent', externalMessageId: 'gmail-3' })
    em.nativeUpdate.mockResolvedValueOnce(0)
    primeFinds(link, [])

    await deliverOutboundMessageCommand.execute({ messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } }, ctx)

    expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channelMetadata: expect.objectContaining({ to: ['legacy@example.com'], bcc: ['hidden@example.com'] }),
    }))
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('planParticipantFailure', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const base = { error: 'boom', transient: false, requiresReauth: false, forcedRefresh: false, messageSentAt: now }

  it('retries a reauth failure right away until the forced refresh also failed', () => {
    expect(planParticipantFailure(['p-a'], { ...base, requiresReauth: true }, now)).toEqual({
      retry: [{ id: 'p-a', error: 'boom', nextAttemptAt: now }],
    })
    expect(planParticipantFailure(['p-a'], { ...base, requiresReauth: true, forcedRefresh: true }, now)).toEqual({
      failed: [{ id: 'p-a', error: 'boom' }],
    })
  })

  it('fails transient errors outside the delivery window', () => {
    const old = new Date(now.getTime() - 25 * 3_600_000)
    expect(planParticipantFailure(['p-a'], { ...base, transient: true, messageSentAt: old }, now)).toEqual({
      failed: [{ id: 'p-a', error: 'delivery window exceeded' }],
    })
  })
})
