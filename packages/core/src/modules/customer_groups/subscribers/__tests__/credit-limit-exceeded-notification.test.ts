// Release 5 Phase 3 (G15, Step 1.8) — the `customer_groups.credit.limit_exceeded`
// subscriber delegates recipient resolution to `lib/creditNotifications.ts` (covered in
// depth by `lib/__tests__/creditNotifications.test.ts`); this test only proves the
// subscriber reads the event payload correctly and forwards it.

const createCreditLimitExceededNotificationMock = jest.fn(async () => {})

jest.mock('../../lib/creditNotifications', () => ({
  createCreditLimitExceededNotification: (...args: unknown[]) => createCreditLimitExceededNotificationMock(...args),
}))

import handle from '../credit-limit-exceeded-notification'

describe('customer_groups credit-limit-exceeded-notification subscriber', () => {
  const em = { fork: () => em }
  const ctx = { resolve: jest.fn(() => em) }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('forwards the event payload to the shared notification builder', async () => {
    await handle(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        creditAccountId: 'account-1',
        customerId: 'customer-1',
        currencyCode: 'USD',
        requestedAmount: '150.00',
        creditLimit: '100.00',
      },
      ctx,
    )

    expect(createCreditLimitExceededNotificationMock).toHaveBeenCalledTimes(1)
    expect(createCreditLimitExceededNotificationMock).toHaveBeenCalledWith(
      em,
      expect.objectContaining({ resolve: expect.any(Function) }),
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        creditAccountId: 'account-1',
        customerId: 'customer-1',
        currencyCode: 'USD',
        requestedAmount: '150.00',
        creditLimit: '100.00',
      },
    )
  })

  it('skips an incomplete payload without throwing', async () => {
    await expect(handle({ creditAccountId: 'account-1' }, ctx)).resolves.toBeUndefined()
    expect(createCreditLimitExceededNotificationMock).not.toHaveBeenCalled()
  })
})
