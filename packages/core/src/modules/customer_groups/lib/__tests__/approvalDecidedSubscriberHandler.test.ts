// Release 5 Phase 4 (G15, D-R5-6, Step 2.7) — shared dispatch logic behind the
// three `.approved`/`.rejected`/`.expired` subscribers.

const sendApprovalDecidedRequesterEmailMock = jest.fn(async () => {})

jest.mock('../approvalEmails', () => ({
  sendApprovalDecidedRequesterEmail: (...args: unknown[]) => sendApprovalDecidedRequesterEmailMock(...args),
}))

import { createApprovalDecidedHandler } from '../approvalDecidedSubscriberHandler'

describe('createApprovalDecidedHandler', () => {
  const em = { fork: () => em }
  const ctx = { resolve: jest.fn((name: string) => (name === 'em' ? em : undefined)) }

  const payload = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    amountGross: '500.00',
    currencyCode: 'USD',
    requestedBy: { actorType: 'customer_user', actorId: 'requester-1' },
  }

  beforeEach(() => jest.clearAllMocks())

  it('forwards the event payload with the bound status', async () => {
    const handle = createApprovalDecidedHandler('approved', 'customer_groups:approval-approved-notification')
    await handle(payload, ctx)

    expect(sendApprovalDecidedRequesterEmailMock).toHaveBeenCalledTimes(1)
    expect(sendApprovalDecidedRequesterEmailMock).toHaveBeenCalledWith(
      em,
      expect.objectContaining({ resolve: expect.any(Function) }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        approvalId: 'approval-1',
        status: 'approved',
        requestedBy: { actorType: 'customer_user', actorId: 'requester-1' },
      }),
    )
  })

  it('binds a different status per handler instance', async () => {
    const handle = createApprovalDecidedHandler('rejected', 'customer_groups:approval-rejected-notification')
    await handle(payload, ctx)
    expect(sendApprovalDecidedRequesterEmailMock).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ status: 'rejected' }),
    )
  })

  it('skips an incomplete payload without throwing', async () => {
    const handle = createApprovalDecidedHandler('expired', 'customer_groups:approval-expired-notification')
    await expect(handle({ approvalId: 'approval-1' }, ctx)).resolves.toBeUndefined()
    expect(sendApprovalDecidedRequesterEmailMock).not.toHaveBeenCalled()
  })
})
