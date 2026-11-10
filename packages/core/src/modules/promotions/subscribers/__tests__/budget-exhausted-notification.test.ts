// #8268 review Major 7 — the `promotions.promotion.budget_exhausted` subscriber delegates
// to `lib/usageAccountingNotifications.ts`; this test only proves it reads the event
// payload correctly and forwards it.

const createUsageReinstateBlockedNotificationMock = jest.fn(async () => {})

jest.mock('../../lib/usageAccountingNotifications', () => ({
  createUsageReinstateBlockedNotification: (...args: unknown[]) => createUsageReinstateBlockedNotificationMock(...args),
}))

import handle from '../budget-exhausted-notification'

describe('promotions budget-exhausted-notification subscriber', () => {
  const container = { resolve: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('forwards the event payload to the shared notification builder', async () => {
    await handle(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        orderId: 'order-1',
        promotionId: 'promotion-1',
      },
      container,
    )

    expect(createUsageReinstateBlockedNotificationMock).toHaveBeenCalledTimes(1)
    expect(createUsageReinstateBlockedNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolve: expect.any(Function) }),
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        orderId: 'order-1',
        reason: 'budget_exhausted',
      },
    )
  })

  it('skips an incomplete payload without throwing', async () => {
    await expect(handle({ promotionId: 'promotion-1' }, container)).resolves.toBeUndefined()
    expect(createUsageReinstateBlockedNotificationMock).not.toHaveBeenCalled()
  })

  it('does not throw when the notification builder itself fails', async () => {
    createUsageReinstateBlockedNotificationMock.mockRejectedValueOnce(new Error('boom'))

    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1' },
      container,
    )).resolves.toBeUndefined()
  })
})
