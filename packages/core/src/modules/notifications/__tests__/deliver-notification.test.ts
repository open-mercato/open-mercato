import type { Notification } from '../data/entities'
import type { NotificationDeliveryConfig } from '../lib/deliveryConfig'
import type { NotificationDeliveryStrategy } from '../lib/deliveryStrategies'

const sendEmail = jest.fn()
const getNotificationDeliveryStrategies = jest.fn()
const resolveNotificationDeliveryConfig = jest.fn()
const resolveNotificationPanelUrl = jest.fn()
const findOneWithDecryption = jest.fn()
const NotificationEmail = jest.fn(() => 'notification-email')

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('../lib/deliveryStrategies', () => ({
  getNotificationDeliveryStrategies: (...args: unknown[]) => getNotificationDeliveryStrategies(...args),
}))

jest.mock('../lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: {
    panelPath: '/backend/notifications',
    strategies: {
      database: { enabled: true },
      email: { enabled: true },
      custom: {},
    },
  },
  resolveNotificationDeliveryConfig: (...args: unknown[]) => resolveNotificationDeliveryConfig(...args),
  resolveNotificationPanelUrl: (...args: unknown[]) => resolveNotificationPanelUrl(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('../emails/NotificationEmail', () => ({
  __esModule: true,
  default: (...args: unknown[]) => NotificationEmail(...args),
}))

describe('deliver notification subscriber', () => {
  const notification: Notification = {
    id: '32e22a6e-7aa9-4f3b-8a7b-42c2d1223a5f',
    recipientUserId: '3eae68bb-1e4c-4b21-85c7-b8f5b2c22b01',
    tenantId: 'c33b6f78-8c4b-4ef4-9c54-2b64b5f5d0d0',
    organizationId: null,
    type: 'system',
    title: 'New notification',
    body: 'Check details',
    titleKey: null,
    bodyKey: null,
    titleVariables: null,
    bodyVariables: null,
    icon: null,
    severity: 'info',
    actionData: {
      actions: [{ id: 'action-1', label: 'Review' }],
      primaryActionId: 'action-1',
    },
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    linkHref: null,
    groupKey: null,
    status: 'unread',
    readAt: null,
    actionedAt: null,
    dismissedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    actionTaken: null,
    actionResult: null,
  } as Notification

  const baseConfig: NotificationDeliveryConfig = {
    appUrl: 'https://app.example.com',
    panelPath: '/backend/notifications',
    strategies: {
      database: { enabled: true },
      email: {
        enabled: true,
        from: 'notifications@example.com',
        replyTo: 'reply@example.com',
        subjectPrefix: '[OM]',
      },
      custom: {},
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends email notifications when enabled', async () => {
    resolveNotificationDeliveryConfig.mockResolvedValue(baseConfig)
    resolveNotificationPanelUrl.mockReturnValue('https://app.example.com/backend/notifications')
    getNotificationDeliveryStrategies.mockReturnValue([])
    findOneWithDecryption.mockResolvedValue({ email: 'user@example.com', name: 'User' })

    const em = {
      findOne: jest.fn().mockResolvedValue(notification),
    }

    const { default: handle } = await import('../subscribers/deliver-notification')

    await handle(
      {
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        tenantId: notification.tenantId,
        organizationId: null,
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Missing dependency: ${name}`)
        },
      }
    )

    expect(NotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: notification.title,
        panelUrl: `https://app.example.com/backend/notifications?notificationId=${notification.id}`,
      })
    )
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: baseConfig.strategies.email.from,
        replyTo: baseConfig.strategies.email.replyTo,
        subject: `${baseConfig.strategies.email.subjectPrefix} ${notification.title}`,
      })
    )
  })

  it('executes enabled custom delivery strategies', async () => {
    const customStrategy: NotificationDeliveryStrategy = {
      id: 'webhook',
      deliver: jest.fn(),
    }
    resolveNotificationDeliveryConfig.mockResolvedValue({
      ...baseConfig,
      strategies: {
        ...baseConfig.strategies,
        email: { enabled: false },
        custom: {
          webhook: { enabled: true, config: { url: 'https://hooks.example.com' } },
        },
      },
    })
    resolveNotificationPanelUrl.mockReturnValue('/backend/notifications')
    getNotificationDeliveryStrategies.mockReturnValue([customStrategy])
    findOneWithDecryption.mockResolvedValue({ email: 'user@example.com', name: 'User' })

    const em = {
      findOne: jest.fn().mockResolvedValue(notification),
    }

    const { default: handle } = await import('../subscribers/deliver-notification')

    await handle(
      {
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        tenantId: notification.tenantId,
        organizationId: null,
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Missing dependency: ${name}`)
        },
      }
    )

    expect(customStrategy.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { enabled: true, config: { url: 'https://hooks.example.com' } },
        panelLink: `/backend/notifications?notificationId=${notification.id}`,
      })
    )
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
