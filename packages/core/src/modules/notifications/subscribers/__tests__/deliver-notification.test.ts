import handle from '../deliver-notification'
import { Notification } from '../../data/entities'
import { User } from '../../../auth/data/entities'
// Real email strategy (sendEmail + NotificationEmail mocked below) — registered by tests that
// exercise email, exactly as bootstrap would register it.
import { emailDeliveryStrategy } from '../../lib/strategies/email-delivery-strategy'

const findOneWithDecryptionMock = jest.fn()
const loadDictionaryMock = jest.fn()
const sendEmailMock = jest.fn()
const resolveNotificationDeliveryConfigMock = jest.fn()
const resolveNotificationPanelUrlMock = jest.fn()
const getNotificationDeliveryStrategiesMock = jest.fn()
const resolveEffectiveChannelsMock = jest.fn()
const getNotificationTypeMock = jest.fn()
const resolveNotificationPreferenceServiceMock = jest.fn()

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

jest.mock('../../lib/shouldDeliver', () => ({
  resolveEffectiveChannels: (...args: unknown[]) => resolveEffectiveChannelsMock(...args),
}))

jest.mock('../../lib/notification-type-registry', () => ({
  getNotificationType: (...args: unknown[]) => getNotificationTypeMock(...args),
}))

jest.mock('../../lib/typeOverrides', () => ({
  getNotificationTypeOverrides: async () => new Map(),
}))

jest.mock('../../lib/notificationPreferenceService', () => ({
  resolveNotificationPreferenceService: (...args: unknown[]) => resolveNotificationPreferenceServiceMock(...args),
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
    // Default: a null-channels row recomputes to every registered channel (no opt-out), preserving
    // pre-Phase-7 "deliver everywhere" behavior. Opt-out tests override this.
    resolveEffectiveChannelsMock.mockImplementation(
      async ({ registeredChannels }: { registeredChannels: string[] }) => registeredChannels,
    )
    getNotificationTypeMock.mockReturnValue(undefined)
    resolveNotificationPreferenceServiceMock.mockReturnValue({
      isChannelEnabled: jest.fn().mockResolvedValue(true),
    })
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
    getNotificationDeliveryStrategiesMock.mockReturnValue([emailDeliveryStrategy])
    sendEmailMock.mockRejectedValue(new Error('SMTP connection refused'))

    await expect(handle(basePayload, buildCtx() as never)).resolves.toBeUndefined()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  describe('null channels snapshot (legacy / pre-bootstrap rows)', () => {
    const pushDeliver = jest.fn()
    const pushStrategy = { id: 'push', defaultEnabled: true, deliver: pushDeliver }

    beforeEach(() => {
      pushDeliver.mockReset()
      getNotificationDeliveryStrategiesMock.mockReturnValue([pushStrategy])
      findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
        if (entity === Notification) return { ...baseNotification, type: 'orders.shipped', channels: null }
        if (entity === User) return { email: 'user@example.com', name: 'User' }
        return null
      })
    })

    it('re-gates on current preferences and skips a channel the recipient opted out of', async () => {
      resolveEffectiveChannelsMock.mockResolvedValue([]) // recipient opted out of push for this type

      await handle(basePayload, buildCtx() as never)

      expect(resolveEffectiveChannelsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          typeId: 'orders.shipped',
          scope: { tenantId: 'tenant-1', userId: 'user-1' },
          targetChannels: null,
          registeredChannels: ['push'],
        }),
      )
      expect(pushDeliver).not.toHaveBeenCalled()
    })

    it('delivers when the recipient has not opted out (recompute keeps the channel)', async () => {
      resolveEffectiveChannelsMock.mockResolvedValue(['push'])

      await handle(basePayload, buildCtx() as never)

      expect(pushDeliver).toHaveBeenCalledTimes(1)
    })

    it('persists the recomputed channel set (excluding in_app) back onto the null-channels row', async () => {
      // Recipient opted out of in_app for this type: the recomputed set excludes it. The subscriber
      // must write that set back via a forked nativeUpdate so the in-app VISIBILITY path (bell/inbox/
      // unread — notificationVisibility.ts) agrees with what DELIVERY just gated, instead of leaving
      // the row null ⇒ "visible everywhere".
      resolveEffectiveChannelsMock.mockResolvedValue(['push', 'email'])
      const nativeUpdate = jest.fn(async () => 1)
      const em = { fork: () => ({ nativeUpdate }) }
      const ctx = {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown service: ${name}`)
        },
      }

      await handle(basePayload, ctx as never)

      expect(nativeUpdate).toHaveBeenCalledWith(
        Notification,
        { id: 'notif-1', tenantId: 'tenant-1' },
        { channels: ['push', 'email'] },
      )
      const writtenChannels = (nativeUpdate.mock.calls[0][2] as { channels: string[] }).channels
      expect(writtenChannels).not.toContain('in_app')
    })

    it('does not persist channels when the recompute returns null (legacy all-channels preserved)', async () => {
      resolveEffectiveChannelsMock.mockResolvedValue(null)
      const nativeUpdate = jest.fn(async () => 1)
      const em = { fork: () => ({ nativeUpdate }) }
      const ctx = {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unknown service: ${name}`)
        },
      }

      await handle(basePayload, ctx as never)

      expect(nativeUpdate).not.toHaveBeenCalled()
    })
  })

  it('honors a non-null channels snapshot without recomputing from preferences', async () => {
    const pushDeliver = jest.fn()
    getNotificationDeliveryStrategiesMock.mockReturnValue([
      { id: 'push', defaultEnabled: true, deliver: pushDeliver },
    ])
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Notification) return { ...baseNotification, type: 'orders.shipped', channels: ['in_app'] }
      if (entity === User) return { email: 'user@example.com', name: 'User' }
      return null
    })

    await handle(basePayload, buildCtx() as never)

    expect(resolveEffectiveChannelsMock).not.toHaveBeenCalled()
    expect(pushDeliver).not.toHaveBeenCalled() // 'push' not in the ['in_app'] snapshot
  })
})
