import handle from '../deliver-notification'
import { Notification } from '../../data/entities'
import { User } from '../../../auth/data/entities'

const findOneWithDecryptionMock = jest.fn()
const loadDictionaryMock = jest.fn()
const sendEmailMock = jest.fn()
const resolveNotificationDeliveryConfigMock = jest.fn()
const resolveNotificationPanelUrlMock = jest.fn()
const getNotificationDeliveryStrategiesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: (...args: unknown[]) => loadDictionaryMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/shared/lib/i18n/config', () => ({
  defaultLocale: 'en',
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

jest.mock('../../lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: { strategies: { email: { enabled: false }, custom: {} } },
  resolveNotificationDeliveryConfig: (...args: unknown[]) => resolveNotificationDeliveryConfigMock(...args),
  resolveNotificationPanelUrl: (...args: unknown[]) => resolveNotificationPanelUrlMock(...args),
}))

jest.mock('../../lib/deliveryStrategies', () => ({
  getNotificationDeliveryStrategies: () => getNotificationDeliveryStrategiesMock(),
}))

jest.mock('../../emails/NotificationEmail', () => () => null)

describe('deliver-notification subscriber', () => {
  const baseNotification = {
    id: 'notif-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    recipientUserId: 'user-1',
    titleKey: null,
    title: 'Test Notification',
    bodyKey: null,
    body: 'Test Body',
    titleVariables: null,
    bodyVariables: null,
    actionData: null,
    sourceEntityId: null,
  }

  const basePayload = {
    notificationId: 'notif-1',
    recipientUserId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  function buildCtx() {
    const em = {}
    return {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`Unknown service: ${name}`)
      },
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    resolveNotificationDeliveryConfigMock.mockResolvedValue({
      strategies: { email: { enabled: false }, custom: {} },
    })
    resolveNotificationPanelUrlMock.mockReturnValue(null)
    getNotificationDeliveryStrategiesMock.mockReturnValue([])
    loadDictionaryMock.mockResolvedValue({})
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Notification) return baseNotification
      if (entity === User) return { email: 'user@example.com', name: 'User' }
      return null
    })
  })

  it('returns early without sending when notification is not found', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    await handle(basePayload, buildCtx() as never)

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('re-throws when resolveNotificationCopy fails so the event bus can retry', async () => {
    loadDictionaryMock.mockRejectedValue(new Error('i18n service unavailable'))

    await expect(handle(basePayload, buildCtx() as never)).rejects.toThrow('i18n service unavailable')
  })

  it('re-throws when resolveRecipient fails so the event bus can retry', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Notification) return baseNotification
      throw new Error('database connection lost')
    })

    await expect(handle(basePayload, buildCtx() as never)).rejects.toThrow('database connection lost')
  })

  it('does not throw when email send fails (inner catch absorbs it)', async () => {
    resolveNotificationDeliveryConfigMock.mockResolvedValue({
      strategies: {
        email: {
          enabled: true,
          from: 'noreply@example.com',
          subjectPrefix: null,
          replyTo: null,
        },
        custom: {},
      },
    })
    resolveNotificationPanelUrlMock.mockReturnValue('https://app.example.com/notifications')
    sendEmailMock.mockRejectedValue(new Error('SMTP connection refused'))

    await expect(handle(basePayload, buildCtx() as never)).resolves.toBeUndefined()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
})
