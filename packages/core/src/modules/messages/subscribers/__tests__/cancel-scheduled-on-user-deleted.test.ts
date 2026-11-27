import { Message } from '../../data/entities'
import handler, { metadata } from '../cancel-scheduled-on-user-deleted'

const tenantId = '22222222-2222-4222-8222-222222222222'
const userId = '44444444-4444-4444-8444-444444444444'

function createCtx() {
  const em = { nativeUpdate: jest.fn(async () => 2) }
  return { em, ctx: { resolve: jest.fn(() => ({ fork: () => em })) as never } }
}

describe('messages:cancel-scheduled-on-user-deleted', () => {
  it('subscribes persistently to auth.user.deleted', () => {
    expect(metadata).toEqual({ event: 'auth.user.deleted', persistent: true, id: 'messages:cancel-scheduled-on-user-deleted' })
  })

  it('turns the deleted author\'s scheduled messages into drafts within the tenant', async () => {
    const { em, ctx } = createCtx()
    await handler({ id: userId, tenantId }, ctx)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      Message,
      { senderUserId: userId, tenantId, status: 'scheduled', deletedAt: null },
      { status: 'draft', scheduledAt: null },
    )
  })

  it('does nothing without a tenant or user id', async () => {
    const { em, ctx } = createCtx()
    await handler({ id: userId }, ctx)
    await handler({ tenantId }, ctx)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })
})
