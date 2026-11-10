// #8268 review Major 7 — the `promotions.code.exhausted` subscriber delegates to
// `lib/usageAccountingNotifications.ts`; this test proves it reads the event payload
// correctly and forwards it, and that a notification-builder failure propagates (so the
// queue retries the persistent job) instead of being silently swallowed.

const createUsageReinstateBlockedNotificationMock = jest.fn(async () => {})

jest.mock('../../lib/usageAccountingNotifications', () => ({
  createUsageReinstateBlockedNotification: (...args: unknown[]) => createUsageReinstateBlockedNotificationMock(...args),
}))

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import handle from '../code-exhausted-notification'

describe('promotions code-exhausted-notification subscriber', () => {
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
        codeId: 'code-1',
        reason: 'code_cap_exceeded',
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
        reason: 'code_exhausted',
      },
    )
  })

  it('skips an incomplete payload without throwing', async () => {
    await expect(handle({ codeId: 'code-1' }, container)).resolves.toBeUndefined()
    expect(createUsageReinstateBlockedNotificationMock).not.toHaveBeenCalled()
  })

  it('propagates (and reports) a notification-builder failure so the queue retries', async () => {
    const err = new Error('boom')
    createUsageReinstateBlockedNotificationMock.mockRejectedValueOnce(err)

    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1' },
      container,
    )).rejects.toThrow('boom')

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(err, expect.objectContaining({
      module: 'promotions',
      code: 'promotions.code_exhausted_notification_failed',
    }))
  })

  it('retries and succeeds on redelivery after a transient failure, creating exactly one notification', async () => {
    createUsageReinstateBlockedNotificationMock.mockRejectedValueOnce(new Error('transient'))

    await expect(handle(
      { tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1' },
      container,
    )).rejects.toThrow('transient')

    await handle({ tenantId: 'tenant-1', organizationId: 'org-1', orderId: 'order-1' }, container)

    expect(createUsageReinstateBlockedNotificationMock).toHaveBeenCalledTimes(2)
  })
})
