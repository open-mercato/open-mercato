import type { EntityManager } from '@mikro-orm/postgresql'
import {
  claimExternalDelivery,
  claimRecipientDelivery,
  releaseExternalClaim,
  releaseRecipientClaim,
} from '../send-email.worker'

function createEntityManagerMock() {
  return {
    nativeUpdate: jest.fn<Promise<number>, [unknown, unknown, unknown]>(),
  } as unknown as EntityManager & {
    nativeUpdate: jest.Mock<Promise<number>, [unknown, unknown, unknown]>
  }
}

describe('messages send-email worker claims', () => {
  it('claims recipient delivery only when update matches', async () => {
    const em = createEntityManagerMock()
    em.nativeUpdate.mockResolvedValueOnce(1)

    const claimTimestamp = await claimRecipientDelivery(em, {
      type: 'recipient',
      messageId: '11111111-1111-1111-8111-111111111111',
      recipientUserId: '22222222-2222-2222-8222-222222222222',
      tenantId: '33333333-3333-3333-8333-333333333333',
      organizationId: '44444444-4444-4444-8444-444444444444',
    })

    expect(claimTimestamp).toBeInstanceOf(Date)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('returns null when recipient delivery claim does not match', async () => {
    const em = createEntityManagerMock()
    em.nativeUpdate.mockResolvedValueOnce(0)

    const claimTimestamp = await claimRecipientDelivery(em, {
      type: 'recipient',
      messageId: '11111111-1111-1111-8111-111111111111',
      recipientUserId: '22222222-2222-2222-8222-222222222222',
      tenantId: '33333333-3333-3333-8333-333333333333',
      organizationId: '44444444-4444-4444-8444-444444444444',
    })

    expect(claimTimestamp).toBeNull()
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('claims and releases external delivery with scoped filters', async () => {
    const em = createEntityManagerMock()
    em.nativeUpdate.mockResolvedValueOnce(1)
    em.nativeUpdate.mockResolvedValueOnce(1)

    const payload = {
      type: 'external' as const,
      messageId: '11111111-1111-1111-8111-111111111111',
      email: 'external@example.com',
      tenantId: '33333333-3333-3333-8333-333333333333',
      organizationId: '44444444-4444-4444-8444-444444444444',
    }

    const claimTimestamp = await claimExternalDelivery(em, payload)
    expect(claimTimestamp).toBeInstanceOf(Date)

    await releaseExternalClaim(
      em,
      payload,
      claimTimestamp as Date,
      'send failure',
    )

    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
  })

  it('releases recipient claim with error metadata', async () => {
    const em = createEntityManagerMock()
    em.nativeUpdate.mockResolvedValueOnce(1)

    await releaseRecipientClaim(
      em,
      {
        type: 'recipient',
        messageId: '11111111-1111-1111-8111-111111111111',
        recipientUserId: '22222222-2222-2222-8222-222222222222',
        tenantId: '33333333-3333-3333-8333-333333333333',
        organizationId: '44444444-4444-4444-8444-444444444444',
      },
      new Date('2026-02-15T12:00:00.000Z'),
      'failed',
    )

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })
})
