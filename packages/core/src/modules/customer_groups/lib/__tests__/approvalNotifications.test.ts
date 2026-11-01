// Release 5 Phase 4 (G15, D-R5-6, Step 2.7) — the in-app half of
// `customer_groups.approval.requested`'s fan-out: every merchant decider
// (`customer_groups.approvals.decide`) in the organization, via
// `createForFeature` + `restrictRecipientsToOrganization: true`.

const createForFeatureMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ createForFeature: createForFeatureMock }))
const buildFeatureNotificationFromTypeMock = jest.fn((typeDef: unknown, options: unknown) => ({ typeDef, ...(options as object) }))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('../../../notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))
jest.mock('../../notifications', () => ({
  notificationTypes: [
    { type: 'customer_groups.approval.requested', module: 'customer_groups', titleKey: 'customer_groups.notifications.approvalRequested.title' },
  ],
}))

import { notifyMerchantDecidersOfApprovalRequested } from '../approvalNotifications'

describe('notifyMerchantDecidersOfApprovalRequested', () => {
  const container = { resolve: jest.fn() }

  const input = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    approvalId: 'approval-1',
    amountGross: '500.00',
    currencyCode: 'USD',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fans out to every staff holder of approvals.decide in the organization', async () => {
    await notifyMerchantDecidersOfApprovalRequested(container, input)

    expect(createForFeatureMock).toHaveBeenCalledTimes(1)
    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer_groups.approval.requested' }),
      expect.objectContaining({
        requiredFeature: 'customer_groups.approvals.decide',
        sourceEntityId: 'approval-1',
        sourceEntityType: 'customer_groups:purchase_approval',
        groupKey: 'customer_groups.approval.requested:approval-1',
        bodyVariables: { amountGross: '500.00', currencyCode: 'USD' },
      }),
    )
    expect(createForFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ restrictRecipientsToOrganization: true }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })
})
