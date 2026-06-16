import handle from '../low-stock-notification'

const createForFeatureMock = jest.fn(async () => {})
const resolveNotificationServiceMock = jest.fn(() => ({ createForFeature: createForFeatureMock }))
const buildFeatureNotificationFromTypeMock = jest.fn(() => ({ type: 'wms.inventory.low_stock' }))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))
jest.mock('@open-mercato/core/modules/wms/notifications', () => ({
  notificationTypes: [
    { type: 'wms.inventory.low_stock', module: 'wms', titleKey: 'wms.notifications.lowStock.title' },
  ],
}))

describe('wms low-stock-notification subscriber', () => {
  const ctx = { resolve: jest.fn(() => ({ fork: () => ({}) })) }

  const basePayload = {
    catalogVariantId: 'variant-uuid-1',
    availableQuantity: 3,
    reorderPoint: 10,
    safetyStock: 5,
    state: 'below_safety_stock' as const,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves the notification service and creates a notification', async () => {
    await handle(basePayload, ctx)

    expect(resolveNotificationServiceMock).toHaveBeenCalledTimes(1)
    expect(createForFeatureMock).toHaveBeenCalledTimes(1)
    expect(createForFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wms.inventory.low_stock' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('passes correct bodyVariables including safetyStock and state', async () => {
    await handle(basePayload, ctx)

    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wms.inventory.low_stock' }),
      expect.objectContaining({
        bodyVariables: {
          availableQuantity: '3',
          reorderPoint: '10',
          safetyStock: '5',
          state: 'below_safety_stock',
        },
        sourceEntityType: 'wms:inventory_balance',
        sourceEntityId: 'variant-uuid-1',
        linkHref: '/backend/wms/sku/variant-uuid-1',
      }),
    )
  })

  it('passes null organizationId through to createForFeature', async () => {
    await handle({ ...basePayload, organizationId: null }, ctx)

    expect(createForFeatureMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      organizationId: null,
    })
  })

  it('passes correct bodyVariables for below_reorder_point state', async () => {
    await handle({ ...basePayload, state: 'below_reorder_point', availableQuantity: 8 }, ctx)

    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyVariables: expect.objectContaining({
          availableQuantity: '8',
          state: 'below_reorder_point',
        }),
      }),
    )
  })
})
