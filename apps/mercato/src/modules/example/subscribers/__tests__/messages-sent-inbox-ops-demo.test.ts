/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()
const mockEmitSourceSubmissionRequested = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/source-submission-request', () => ({
  emitSourceSubmissionRequested: (...args: unknown[]) => mockEmitSourceSubmissionRequested(...args),
}))

import handle, { metadata } from '../messages-sent-inbox-ops-demo'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'

const mockEm = {
  fork: jest.fn(),
}

const mockCtx = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    throw new Error(`Unknown DI token: ${token}`)
  }),
}

describe('example messages sent demo inbox ops subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
  })

  it('registers as a persistent exact-match subscriber', () => {
    expect(metadata).toEqual({
      event: 'messages.message.sent',
      persistent: true,
      id: 'example:messages-sent-inbox-ops-demo',
    })
  })

  it('routes [AI]-prefixed messages to inbox ops', async () => {
    const sentAt = new Date('2026-04-19T11:00:00.000Z')
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      senderUserId: USER_ID,
      subject: '[AI] Follow up on quote',
      sentAt,
      createdAt: new Date('2026-04-19T10:55:00.000Z'),
    })

    await handle({
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }, mockCtx)

    expect(mockEmitSourceSubmissionRequested).toHaveBeenCalledWith({
      descriptor: {
        sourceEntityType: 'messages:message',
        sourceEntityId: MESSAGE_ID,
        sourceVersion: sentAt.toISOString(),
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        requestedByUserId: USER_ID,
        triggerEventId: 'messages.message.sent',
      },
    })
  })

  it('ignores sent messages without the demo prefix', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      senderUserId: USER_ID,
      subject: 'Regular message',
      sentAt: new Date('2026-04-19T11:00:00.000Z'),
      createdAt: new Date('2026-04-19T10:55:00.000Z'),
    })

    await handle({
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }, mockCtx)

    expect(mockEmitSourceSubmissionRequested).not.toHaveBeenCalled()
  })

  it('ignores messages without organization scope', async () => {
    await handle({
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: null,
    }, mockCtx)

    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockEmitSourceSubmissionRequested).not.toHaveBeenCalled()
  })
})
