import type { EntityManager } from '@mikro-orm/postgresql'
import handler from '../failed-delivery-notification'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: jest.fn(),
}))

jest.mock('../../lib/integration-settings', () => ({
  resolveWebhookIntegrationSettings: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveWebhookIntegrationSettings } from '../../lib/integration-settings'

describe('webhooks failed delivery notification subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('does not notify when the integration setting is disabled', async () => {
    ;(resolveWebhookIntegrationSettings as jest.Mock).mockResolvedValue({
      notifyOnFailedDelivery: false,
    })

    await handler(
      {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'catalog.product.deleted',
        errorMessage: 'HTTP 500',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: <T,>(name: string): T => {
          if (name === 'em') {
            return {
              fork: jest.fn(),
            } as T
          }

          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(resolveNotificationService).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('creates an admin notification when retries are exhausted and notifications are enabled', async () => {
    const notificationService = {
      createForFeature: jest.fn(async () => []),
    }
    const em = {
      fork: jest.fn(function fork() {
        return em
      }),
    } as unknown as EntityManager

    ;(resolveWebhookIntegrationSettings as jest.Mock).mockResolvedValue({
      notifyOnFailedDelivery: true,
    })
    ;(resolveNotificationService as jest.Mock).mockReturnValue(notificationService)
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
      id: 'webhook-1',
      name: 'Catalog Cleanup',
    })
    ;(buildFeatureNotificationFromType as jest.Mock).mockReturnValue({
      type: 'webhooks.delivery.failed',
      requiredFeature: 'webhooks.manage',
    })

    await handler(
      {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'catalog.product.deleted',
        errorMessage: 'HTTP 500',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: <T,>(name: string): T => {
          if (name === 'em') return em as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(resolveWebhookIntegrationSettings).toHaveBeenCalledWith(
      expect.any(Object),
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )
    expect(findOneWithDecryption).toHaveBeenCalled()
    expect(buildFeatureNotificationFromType).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'webhooks.delivery.failed' }),
      expect.objectContaining({
        requiredFeature: 'webhooks.manage',
        sourceEntityId: 'webhook-1',
        linkHref: '/backend/webhooks/webhook-1',
        groupKey: 'delivery-failed:delivery-1',
        titleVariables: {
          webhookName: 'Catalog Cleanup',
        },
        bodyVariables: {
          webhookName: 'Catalog Cleanup',
          eventType: 'catalog.product.deleted',
          errorMessage: 'HTTP 500',
        },
      }),
    )
    expect(notificationService.createForFeature).toHaveBeenCalledWith(
      {
        type: 'webhooks.delivery.failed',
        requiredFeature: 'webhooks.manage',
      },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )
  })
})
