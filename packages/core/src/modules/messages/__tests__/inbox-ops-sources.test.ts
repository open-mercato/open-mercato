/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { inboxOpsSourceAdapters } from '../inbox-ops-sources'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333'
const SENDER_ID = '44444444-4444-4444-8444-444444444444'

const mockEm = {
  fork: jest.fn(),
}

const mockCtx = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    throw new Error(`Unknown token: ${token}`)
  }),
}

describe('messages inbox ops source adapter', () => {
  const adapter = inboxOpsSourceAdapters.find((entry) => entry.sourceEntityType === 'messages:message')

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
  })

  it('registers a message adapter with display metadata', () => {
    expect(adapter).toBeDefined()
    expect(adapter).toEqual(expect.objectContaining({
      sourceEntityType: 'messages:message',
      displayKind: 'message',
      displayIcon: 'message-square',
    }))
  })

  it('builds a normalized inbox ops input from a sent message', async () => {
    if (!adapter) throw new Error('Adapter missing')

    const sentAt = new Date('2026-04-19T10:00:00.000Z')
    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: MESSAGE_ID,
        senderUserId: SENDER_ID,
        subject: '[AI] Need a quote',
        body: 'Please prepare an offer for 20 units.',
        bodyFormat: 'markdown',
        visibility: 'public',
        externalEmail: 'buyer@example.com',
        externalName: 'Buyer',
        sendViaEmail: true,
        type: 'default',
        threadId: null,
        parentMessageId: null,
        sentAt,
        createdAt: new Date('2026-04-19T09:55:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: SENDER_ID,
        email: 'agent@example.com',
        name: 'Agent Smith',
      })

    const descriptor = {
      sourceEntityType: 'messages:message',
      sourceEntityId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }

    const loaded = await adapter.loadSource(descriptor, mockCtx)
    const input = await adapter.buildInput(loaded, descriptor, mockCtx)
    const snapshot = await adapter.buildSnapshot?.(loaded, descriptor, mockCtx)
    const promptHints = await adapter.buildPromptHints?.(loaded, descriptor, mockCtx)

    expect(input).toEqual(expect.objectContaining({
      sourceEntityType: 'messages:message',
      sourceEntityId: MESSAGE_ID,
      sourceVersion: sentAt.toISOString(),
      title: '[AI] Need a quote',
      body: 'Please prepare an offer for 20 units.',
      bodyFormat: 'markdown',
      capabilities: {
        canDraftReply: false,
        replyChannelType: 'email',
        canUseTimelineContext: false,
      },
    }))
    expect(input.participants).toEqual([
      {
        identifier: 'agent@example.com',
        displayName: 'Agent Smith',
        email: 'agent@example.com',
        role: 'sender',
      },
      {
        identifier: 'buyer@example.com',
        displayName: 'Buyer',
        email: 'buyer@example.com',
        role: 'recipient',
      },
    ])
    expect(snapshot).toEqual(expect.objectContaining({
      sourceLabel: 'buyer@example.com',
      sourceKind: 'public message',
    }))
    expect(promptHints).toEqual(expect.objectContaining({
      sourceLabel: 'message',
      sourceKind: 'public message',
      replySupport: 'none',
    }))
  })

  it('fails when the message record does not exist', async () => {
    if (!adapter) throw new Error('Adapter missing')

    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    await expect(adapter.loadSource({
      sourceEntityType: 'messages:message',
      sourceEntityId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }, mockCtx)).rejects.toThrow(`Message not found: ${MESSAGE_ID}`)
  })
})

