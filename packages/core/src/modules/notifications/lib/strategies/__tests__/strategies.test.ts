const sendEmailMock = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

jest.mock('../../../emails/NotificationEmail', () => ({
  __esModule: true,
  default: () => 'email-body',
}))

import { inAppDeliveryStrategy, IN_APP_CHANNEL } from '../in-app-delivery-strategy'
import { emailDeliveryStrategy, EMAIL_CHANNEL } from '../email-delivery-strategy'
import type { NotificationDeliveryContext } from '../../deliveryStrategies'

function ctx(overrides: Partial<NotificationDeliveryContext> = {}): NotificationDeliveryContext {
  return {
    notification: { id: 'n1', type: 'orders.created' } as never,
    recipient: { email: 'user@example.com', name: 'User' },
    title: 'Order created',
    body: 'Your order is in',
    panelUrl: 'https://app.example.com/backend/notifications',
    panelLink: 'https://app.example.com/backend/notifications?notificationId=n1',
    actionLinks: [],
    deliveryConfig: {
      panelPath: '/backend/notifications',
      strategies: { database: { enabled: true }, email: { enabled: true, from: 'x@y.z' }, custom: {} },
    } as never,
    config: {},
    resolve: (() => undefined) as never,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    ...overrides,
  }
}

describe('inAppDeliveryStrategy', () => {
  it('is the in_app channel and its deliver is a no-op (the row is the delivery)', async () => {
    expect(inAppDeliveryStrategy.id).toBe(IN_APP_CHANNEL)
    expect(inAppDeliveryStrategy.defaultEnabled).toBe(true)
    await expect(Promise.resolve(inAppDeliveryStrategy.deliver(ctx()))).resolves.toBeUndefined()
  })
})

describe('emailDeliveryStrategy', () => {
  beforeEach(() => jest.clearAllMocks())

  it('is configured only when tenant email delivery is enabled', () => {
    expect(emailDeliveryStrategy.id).toBe(EMAIL_CHANNEL)
    expect(emailDeliveryStrategy.isConfigured?.(ctx())).toBe(true)
    expect(
      emailDeliveryStrategy.isConfigured?.(
        ctx({ deliveryConfig: { panelPath: '/', strategies: { database: { enabled: true }, email: { enabled: false }, custom: {} } } as never }),
      ),
    ).toBe(false)
  })

  it('sends when a recipient email and panel link are present', async () => {
    await emailDeliveryStrategy.deliver(ctx())
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
  })

  it('skips when the recipient has no email', async () => {
    await emailDeliveryStrategy.deliver(ctx({ recipient: { email: null, name: null } }))
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips when there is no panel link', async () => {
    await emailDeliveryStrategy.deliver(ctx({ panelLink: null }))
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('absorbs send failures (dispatcher must not retry on email errors)', async () => {
    sendEmailMock.mockRejectedValue(new Error('SMTP down'))
    await expect(emailDeliveryStrategy.deliver(ctx())).resolves.toBeUndefined()
  })
})
