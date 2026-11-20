import handle, { metadata } from '../release-scheduled.worker'

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'

function createCtx() {
  const commandBus = { execute: jest.fn(async () => ({ result: { released: [], reverted: [], returnedToDraft: [] } })) }
  const ctx = { resolve: jest.fn(() => commandBus) }
  return { commandBus, ctx: ctx as never }
}

describe('messages release-scheduled worker', () => {
  it('listens on the messages-scheduled-release queue', () => {
    expect(metadata.queue).toBe('messages-scheduled-release')
  })

  it('runs messages.messages.release_scheduled for the scheduled organization', async () => {
    const { commandBus, ctx } = createCtx()
    await handle({ id: 'job', payload: { scope: { tenantId, organizationId } } } as never, ctx)
    expect(commandBus.execute).toHaveBeenCalledWith('messages.messages.release_scheduled', expect.objectContaining({
      input: { tenantId, organizationId },
      ctx: expect.objectContaining({ auth: null, selectedOrganizationId: organizationId }),
    }))
  })

  it('skips a payload without a tenant', async () => {
    const { commandBus, ctx } = createCtx()
    await handle({ id: 'job', payload: {} } as never, ctx)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
