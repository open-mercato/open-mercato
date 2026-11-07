// Release 5 Phase 4 (G15, D-R5-1/D-R5-6, Step 2.7) — `customer_groups.approval.
// requested`'s subscriber dispatches to the in-app merchant fan-out and the buyer
// e-mail fan-out independently, gated by `approvalPolicy`, and tolerates either
// one throwing without blocking the other.

const notifyMerchantDecidersMock = jest.fn(async () => {})
const sendApprovalRequestedBuyerEmailsMock = jest.fn(async () => {})

jest.mock('../../lib/approvalNotifications', () => ({
  notifyMerchantDecidersOfApprovalRequested: (...args: unknown[]) => notifyMerchantDecidersMock(...args),
}))
jest.mock('../../lib/approvalEmails', () => ({
  sendApprovalRequestedBuyerEmails: (...args: unknown[]) => sendApprovalRequestedBuyerEmailsMock(...args),
}))

import handle from '../approval-requested-notification'

describe('customer_groups approval-requested-notification subscriber', () => {
  const em = { fork: () => em }
  const ctx = { resolve: jest.fn((name: string) => (name === 'em' ? em : undefined)) }

  const basePayload = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    customerId: 'company-1',
    amountGross: '500.00',
    currencyCode: 'USD',
    requestedBy: { actorType: 'customer_user', actorId: 'requester-1' },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies only merchant deciders for policy merchant', async () => {
    await handle({ ...basePayload, approvalPolicy: 'merchant' }, ctx)
    expect(notifyMerchantDecidersMock).toHaveBeenCalledTimes(1)
    expect(sendApprovalRequestedBuyerEmailsMock).not.toHaveBeenCalled()
  })

  it('e-mails only buyer deciders for policy buyer', async () => {
    await handle({ ...basePayload, approvalPolicy: 'buyer' }, ctx)
    expect(notifyMerchantDecidersMock).not.toHaveBeenCalled()
    expect(sendApprovalRequestedBuyerEmailsMock).toHaveBeenCalledTimes(1)
  })

  it('does both for policy both', async () => {
    await handle({ ...basePayload, approvalPolicy: 'both' }, ctx)
    expect(notifyMerchantDecidersMock).toHaveBeenCalledTimes(1)
    expect(sendApprovalRequestedBuyerEmailsMock).toHaveBeenCalledTimes(1)
  })

  it('still runs the buyer e-mail when the merchant notification throws', async () => {
    notifyMerchantDecidersMock.mockRejectedValueOnce(new Error('boom'))
    await handle({ ...basePayload, approvalPolicy: 'both' }, ctx)
    expect(sendApprovalRequestedBuyerEmailsMock).toHaveBeenCalledTimes(1)
  })

  it('skips an incomplete payload without throwing', async () => {
    await expect(handle({ approvalId: 'approval-1' }, ctx)).resolves.toBeUndefined()
    expect(notifyMerchantDecidersMock).not.toHaveBeenCalled()
    expect(sendApprovalRequestedBuyerEmailsMock).not.toHaveBeenCalled()
  })
})
