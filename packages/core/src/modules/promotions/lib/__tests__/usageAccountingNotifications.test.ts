// #8268 review Major 7 — shared notification builder for the two orphaned refusal events
// (`promotions.code.exhausted`, `promotions.promotion.budget_exhausted`), so a code-cap
// refusal and a promotion-budget refusal on reinstatement surface the identical
// actionable, order-linked notification instead of only telemetry.

const createMock = jest.fn(async () => ({}))
const createForFeatureMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ create: createMock, createForFeature: createForFeatureMock }))
const buildFeatureNotificationFromTypeMock = jest.fn((typeDef: unknown, options: unknown) => ({ typeDef, ...(options as object) }))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('../../../notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))
jest.mock('../../notifications', () => ({
  notificationTypes: [
    { type: 'promotions.usage.reinstate_blocked', module: 'promotions', titleKey: 'promotions.notifications.usageReinstateBlocked.title' },
  ],
}))

import { createUsageReinstateBlockedNotification } from '../usageAccountingNotifications'

describe('createUsageReinstateBlockedNotification', () => {
  const container = { resolve: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies every staff user holding promotions.usage.manage, linked to the order', async () => {
    await createUsageReinstateBlockedNotification(container, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      orderId: 'order-1',
      reason: 'code_exhausted',
    })

    expect(createForFeatureMock).toHaveBeenCalledTimes(1)
    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'promotions.usage.reinstate_blocked' }),
      expect.objectContaining({
        requiredFeature: 'promotions.usage.manage',
        sourceEntityType: 'sales:sales_order',
        sourceEntityId: 'order-1',
        linkHref: '/backend/sales/orders/order-1',
        groupKey: 'promotions.usage.reinstate_blocked:order-1:code_exhausted',
        bodyVariables: { orderId: 'order-1' },
      }),
    )
    expect(createForFeatureMock).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('keys the dedupe group by reason, so a code refusal and a budget refusal on the same order both surface', async () => {
    await createUsageReinstateBlockedNotification(container, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      orderId: 'order-1',
      reason: 'budget_exhausted',
    })

    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupKey: 'promotions.usage.reinstate_blocked:order-1:budget_exhausted' }),
    )
  })

})
