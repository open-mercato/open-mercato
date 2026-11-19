import type { EntityManager } from '@mikro-orm/postgresql'
import { asFunction, createContainer } from 'awilix'
import handler from '../failed-delivery-notification'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({
    error: (...args: unknown[]) => mockLogError(...args),
    warn: (...args: unknown[]) => mockLogWarning(...args),
  }) }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: jest.fn(),
}))

jest.mock('../../lib/integration-settings', () => ({
  resolveWebhookIntegrationSettings: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveWebhookIntegrationSettings } from '../../lib/integration-settings'

const mockLogError = jest.fn()
const mockLogWarning = jest.fn()

describe('webhooks failed delivery notification subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('does not notify when the integration setting is disabled', async () => {
    const createForFeature = jest.fn()
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
          if (name === 'notificationService') return { createForFeature } as T
          if (name === 'em') {
            return {
              fork: jest.fn(),
            } as T
          }

          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )

    expect(createForFeature).not.toHaveBeenCalled()
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
          if (name === 'notificationService') return notificationService as T
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

  it('skips quietly before settings or ORM access when notifications are not registered', async () => {
    const container = createContainer().createScope()
    const resolve = jest.fn(container.resolve.bind(container))

    await handler(
      {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'catalog.product.deleted',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      { resolve },
    )

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('notificationService', { allowUnregistered: true })
    expect(resolveWebhookIntegrationSettings).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(buildFeatureNotificationFromType).not.toHaveBeenCalled()
    expect(mockLogError).not.toHaveBeenCalled()
    expect(mockLogWarning).not.toHaveBeenCalled()
    expect(getTelemetryRuntime).not.toHaveBeenCalled()
  })

  it.each([
    ['factory', false],
    ['factory', true],
    ['dependency', false],
    ['dependency', true],
  ] as const)('reports registered service %s failures when telemetry throws: %s', async (failure, reporterThrows) => {
    const resolutionError = new Error('Notification service initialization failed')
    const telemetryError = new Error('Telemetry unavailable')
    const reportError = jest.fn(() => {
      if (reporterThrows) throw telemetryError
    })
    jest.mocked(getTelemetryRuntime).mockReturnValue({ reportError } as unknown as NonNullable<ReturnType<typeof getTelemetryRuntime>>)
    const container = createContainer()
    container.register({
      notificationService: failure === 'factory'
        ? asFunction(() => { throw resolutionError }).scoped()
        : asFunction(({ notificationBackend }: { notificationBackend: unknown }) => notificationBackend).scoped().proxy(),
    })
    const scope = container.createScope()

    await expect(handler(
      {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'catalog.product.deleted',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      { resolve: scope.resolve.bind(scope) },
    )).resolves.toBeUndefined()

    const expectedError = failure === 'factory' ? resolutionError : expect.objectContaining({
      name: 'AwilixResolutionError',
      message: expect.stringContaining("Could not resolve 'notificationBackend'"),
    })
    expect(mockLogError).toHaveBeenCalledTimes(1)
    expect(mockLogError).toHaveBeenCalledWith('Failed to create notification', { err: expectedError })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(mockLogError.mock.calls[0][1].err, {
      module: 'webhooks',
      code: 'webhooks.failed_delivery_notification_failed',
    })
    expect(resolveWebhookIntegrationSettings).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(buildFeatureNotificationFromType).not.toHaveBeenCalled()
    if (reporterThrows) {
      expect(mockLogWarning).toHaveBeenCalledWith('Failed to report webhook notification error', { err: telemetryError })
    } else {
      expect(mockLogWarning).not.toHaveBeenCalled()
    }
  })

  it.each([false, true])('preserves swallowed creation failures when telemetry throws: %s', async (reporterThrows) => {
    const error = new Error('Notification storage unavailable')
    const telemetryError = new Error('Telemetry unavailable')
    const createForFeature = jest.fn().mockRejectedValue(error)
    const reportError = jest.fn(() => {
      if (reporterThrows) throw telemetryError
    })
    jest.mocked(getTelemetryRuntime).mockReturnValue({ reportError } as unknown as NonNullable<ReturnType<typeof getTelemetryRuntime>>)
    jest.mocked(resolveWebhookIntegrationSettings).mockResolvedValue({ notifyOnFailedDelivery: true })
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
    jest.mocked(buildFeatureNotificationFromType).mockReturnValue({ type: 'webhooks.delivery.failed' } as ReturnType<typeof buildFeatureNotificationFromType>)
    const em = { fork: jest.fn() }
    em.fork.mockReturnValue(em)

    await expect(handler(
      {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'catalog.product.deleted',
        tenantId: 'tenant-1',
      },
      {
        resolve: <T,>(name: string): T => {
          if (name === 'notificationService') return { createForFeature } as T
          if (name === 'em') return em as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      },
    )).resolves.toBeUndefined()

    expect(createForFeature).toHaveBeenCalledWith(expect.any(Object), { tenantId: 'tenant-1', organizationId: null })
    expect(mockLogError).toHaveBeenCalledWith('Failed to create notification', { err: error })
    expect(reportError).toHaveBeenCalledWith(error, {
      module: 'webhooks',
      code: 'webhooks.failed_delivery_notification_failed',
    })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(mockLogError).toHaveBeenCalledTimes(1)
    if (reporterThrows) {
      expect(mockLogWarning).toHaveBeenCalledWith('Failed to report webhook notification error', { err: telemetryError })
    } else {
      expect(mockLogWarning).not.toHaveBeenCalled()
    }
  })
})
