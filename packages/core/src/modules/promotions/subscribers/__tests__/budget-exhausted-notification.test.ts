// #8268 review Major 7 / Major 8 — the `promotions.promotion.budget_exhausted`
// subscriber delegates to `lib/usageAccountingNotifications.ts`. It must: (a) only notify
// for the actionable `reinstate` origin, never the ordinary `register`-time checkout
// decline (Major 8 — that decline is already compensated/cancelled by `submit.ts`, so a
// "revived order" notification would mislabel it), and (b) propagate a notification-builder
// failure so the queue retries the persistent job instead of silently dropping it
// (Major 7).

const createUsageReinstateBlockedNotificationMock = jest.fn(async () => {})

jest.mock('../../lib/usageAccountingNotifications', () => ({
  createUsageReinstateBlockedNotification: (...args: unknown[]) => createUsageReinstateBlockedNotificationMock(...args),
}))

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import handle from '../budget-exhausted-notification'

describe('promotions budget-exhausted-notification subscriber', () => {
  const container = { resolve: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies for the reinstate origin — a confirmed order kept its discount outside the ledger', async () => {
    await handle(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        orderId: 'order-1',
        promotionId: 'promotion-1',
        origin: 'reinstate',
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

  it('defaults a payload without an origin to reinstate (events emitted before this field existed)', async () => {
    await handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1', promotionId: 'promotion-1' },
      container,
    )

    expect(createUsageReinstateBlockedNotificationMock).toHaveBeenCalledTimes(1)
  })

  it('skips the register origin — an ordinary checkout decline the caller already compensated/cancelled', async () => {
    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1', promotionId: 'promotion-1', origin: 'register' },
      container,
    )).resolves.toBeUndefined()

    expect(createUsageReinstateBlockedNotificationMock).not.toHaveBeenCalled()
  })

  it('skips an incomplete payload without throwing', async () => {
    await expect(handle({ promotionId: 'promotion-1', origin: 'reinstate' }, container)).resolves.toBeUndefined()
    expect(createUsageReinstateBlockedNotificationMock).not.toHaveBeenCalled()
  })

  it('propagates (and reports) a notification-builder failure so the queue retries', async () => {
    const err = new Error('boom')
    createUsageReinstateBlockedNotificationMock.mockRejectedValueOnce(err)

    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1', origin: 'reinstate' },
      container,
    )).rejects.toThrow('boom')

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(err, expect.objectContaining({
      module: 'promotions',
      code: 'promotions.budget_exhausted_notification_failed',
    }))
  })

  it('retries and succeeds on redelivery after a transient failure, creating exactly one notification', async () => {
    createUsageReinstateBlockedNotificationMock.mockRejectedValueOnce(new Error('transient'))

    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1', origin: 'reinstate' },
      container,
    )).rejects.toThrow('transient')

    await handle({ tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1', origin: 'reinstate' }, container)

    expect(createUsageReinstateBlockedNotificationMock).toHaveBeenCalledTimes(2)
  })
})
