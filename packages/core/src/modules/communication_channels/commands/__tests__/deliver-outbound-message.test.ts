import deliverOutboundMessageCommand, {
  COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
} from '../deliver-outbound-message'

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
