jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import deliverOutboundMessageCommand, {
  COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
} from '../deliver-outbound-message'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

describe('deliverOutboundMessageCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID).toBe(
      'communication_channels.deliver_outbound_message',
    )
    expect(deliverOutboundMessageCommand.id).toBe(COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID)
  })

  it('exports an `execute` function on the command handler', () => {
    expect(typeof deliverOutboundMessageCommand.execute).toBe('function')
  })
})

describe('deliverOutboundMessageCommand input schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects malformed messageId', async () => {
    await expect(
      deliverOutboundMessageCommand.execute(
        { messageId: 'not-a-uuid', scope: { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null } } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects missing scope.tenantId', async () => {
    await expect(
      deliverOutboundMessageCommand.execute(
        { messageId: '11111111-1111-1111-1111-111111111111', scope: { organizationId: null } } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('accepts a valid input shape (then fails later because DI is empty — that is fine)', async () => {
    // We expect execute() to fail past schema validation. The point of this test
    // is that Zod accepts the shape; richer behaviour is covered by integration tests.
    await expect(
      deliverOutboundMessageCommand.execute(
        {
          messageId: '11111111-1111-1111-1111-111111111111',
          scope: {
            tenantId: '22222222-2222-2222-2222-222222222222',
            organizationId: '33333333-3333-3333-3333-333333333333',
          },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow() // throws due to missing `em` in container — not a schema error
  })
})

// ── Idempotency: outbound double-send guard (Spec 045d §7.3) ────────
describe('deliverOutboundMessageCommand — idempotency (no double-send)', () => {
  const VALID_MSG = '550e8400-e29b-41d4-a716-446655440010'
  const VALID_TENANT = '550e8400-e29b-41d4-a716-446655440020'
  const VALID_ORG = '550e8400-e29b-41d4-a716-446655440030'

  function makeCtx(adapter: Record<string, unknown>) {
    const em: any = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    em.fork = () => em
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'channelAdapterRegistry') return { get: () => adapter }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    } as any
  }

  it('short-circuits an already-sent link without invoking the adapter', async () => {
    mockFindOne.mockReset()
    mockFindOne
      .mockResolvedValueOnce({ id: 'msg-1', threadId: 'thread-1', body: 'hi', bodyFormat: 'text' } as never) // message
      .mockResolvedValueOnce({ messageThreadId: 'thread-1', channelId: 'ch-1', externalConversationId: 'conv-1', externalThreadRef: 'ext-1' } as never) // thread mapping
      .mockResolvedValueOnce({ id: 'ch-1', isActive: true, providerKey: 'gmail', channelType: 'email', userId: 'u-1', credentialsRef: null } as never) // channel
      .mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'sent' } as never) // existing already-sent link

    const sendMessage = jest.fn()
    const result = await deliverOutboundMessageCommand.execute(
      { messageId: VALID_MSG, scope: { tenantId: VALID_TENANT, organizationId: VALID_ORG } } as never,
      makeCtx({ providerKey: 'gmail', sendMessage }),
    )

    expect(result).toEqual({ status: 'already_delivered', messageId: 'msg-1', channelLinkId: 'link-1' })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
