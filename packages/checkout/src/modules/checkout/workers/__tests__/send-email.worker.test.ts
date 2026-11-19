import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const sendEmail = jest.fn()
const findOneWithDecryption = jest.fn()
const resolveNotificationDeliveryConfig = jest.fn()
const consume = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: {
    panelPath: '/backend/notifications',
    strategies: {
      database: { enabled: true },
      email: { enabled: true },
      custom: {},
    },
  },
  resolveNotificationDeliveryConfig: (...args: unknown[]) => resolveNotificationDeliveryConfig(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    t: (translationKey: string, fallbackOrVars?: string | Record<string, string>, vars?: Record<string, string>) => {
      const fallback = typeof fallbackOrVars === 'string'
        ? fallbackOrVars
        : translationKey.endsWith('.greeting') ? 'Hello {firstName}, {linkTitle}' : translationKey
      const variables = typeof fallbackOrVars === 'object' ? fallbackOrVars : vars
      return fallback.replace(/\{(\w+)\}/g, (match, key: string) => variables?.[key] ?? match)
    },
  }),
}))

jest.mock('../../emails/PaymentStartEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

jest.mock('../../emails/PaymentSuccessEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

jest.mock('../../emails/PaymentErrorEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

describe('checkout send-email worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    consume.mockResolvedValue({ allowed: true })
    resolveNotificationDeliveryConfig.mockResolvedValue({
      panelPath: '/backend/notifications',
      strategies: {
        database: { enabled: true },
        email: {
          enabled: true,
          from: 'notifications@example.com',
          replyTo: 'reply@example.com',
        },
        custom: {},
      },
    })
  })

  async function runEmail(type: 'start' | 'success' | 'error', options: {
    firstName?: string
    body?: string | null
    errorMessage?: string
  } = {}) {
    findOneWithDecryption
      .mockResolvedValueOnce({
        id: 'txn-1', linkId: 'link-1', email: 'buyer@example.com',
        firstName: options.firstName ?? 'Buyer', amount: '33.00', currencyCode: 'USD',
      })
      .mockResolvedValueOnce({
        id: 'link-1', title: 'Shop',
        [`${type}EmailBody`]: options.body,
        [`${type}EmailSubject`]: 'Payment for {{firstName}}',
      })
    const { default: handle } = await import('../send-email.worker')
    await handle({ payload: {
      type, transactionId: 'txn-1', tenantId: 'tenant-1', organizationId: 'org-1',
      ...(type === 'error' ? { errorMessage: options.errorMessage } : {}),
    } } as never, { resolve: (name: string) => {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'rateLimiterService') return { consume }
      throw new Error(`[internal] Missing dependency: ${name}`)
    } } as never)
  }

  it.each(['start', 'success', 'error'] as const)('renders %s variables as literal text inside trusted Markdown', async (type) => {
    await runEmail(type, {
      firstName: 'Eve\r\n# Heading\n[Visit](https://attacker.example) **bold** <img src=x>',
      body: '# Merchant\n\nHello **{{firstName}}**\n\n[Receipt](https://merchant.example)',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Payment for Eve # Heading [Visit](https://attacker.example) **bold** <img src=x>',
      react: expect.objectContaining({
        bodyHtml: '<h1>Merchant</h1><p>Hello <strong>Eve # Heading [Visit](https://attacker.example) **bold** &lt;img src=x&gt;</strong></p><p><a href="https://merchant.example">Receipt</a></p>',
      }),
    }))
    const templatePaths = {
      start: '../../emails/PaymentStartEmail',
      success: '../../emails/PaymentSuccessEmail',
      error: '../../emails/PaymentErrorEmail',
    }
    const { default: Template } = jest.requireActual<{ default: (props: Record<string, unknown>) => ReactElement }>(templatePaths[type])
    const html = renderToStaticMarkup(Template(sendEmail.mock.calls[0][0].react))
    expect(html).not.toContain('href="https://attacker.example"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<h1>Heading')
    expect(html).toContain('href="https://merchant.example"')
  })

  it.each(['start', 'success', 'error'] as const)('collapses line breaks in the default %s greeting', async (type) => {
    await runEmail(type, { firstName: 'Eve\r\n# Heading\u2028More', body: null })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      react: expect.objectContaining({
        firstName: 'Eve # Heading More', bodyHtml: null,
        copy: expect.objectContaining({ greeting: 'Hello Eve # Heading More, Shop' }),
      }),
    }))
  })

  it('escapes error variables and never expands variables inside HTML attributes or recursively', async () => {
    await runEmail('error', {
      firstName: '{{amount}}', errorMessage: '\n[Visit](https://attacker.example) "<&',
      body: '{{firstName}} {{errorMessage}} [View](https://merchant.example/{{firstName}})',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      react: expect.objectContaining({ bodyHtml: '<p>{{amount}} [Visit](https://attacker.example) &quot;&lt;&amp; <a href="https://merchant.example/{{firstName}}">View</a></p>' }),
    }))
  })

  it('suppresses start emails when their send budget is exhausted', async () => {
    consume.mockResolvedValueOnce({ allowed: false })
    await runEmail('start')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not send when the start email budget cannot be checked', async () => {
    consume.mockResolvedValueOnce({ allowed: true, degraded: true })
    await expect(runEmail('start')).rejects.toThrow('budget is unavailable')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('keeps success and error receipts outside the pre-payment send budget', async () => {
    consume.mockResolvedValue({ allowed: false })
    await runEmail('success')
    await runEmail('error')
    expect(consume).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it('uses notification delivery sender settings for checkout emails', async () => {
    findOneWithDecryption
      .mockResolvedValueOnce({
        id: 'txn-1',
        linkId: 'link-1',
        email: 'buyer@example.com',
        firstName: 'Piotr',
        amount: '33.00',
        currencyCode: 'USD',
      })
      .mockResolvedValueOnce({
        id: 'link-1',
        title: 'Spring Gala 2026',
        name: 'Spring Gala 2026',
        successEmailSubject: 'Your Spring Gala ticket is confirmed',
        successEmailBody: null,
        sendSuccessEmail: true,
      })

    const { default: handle } = await import('../send-email.worker')

    await handle(
      {
        payload: {
          type: 'success',
          transactionId: 'txn-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      {
        resolve: (name: string) => {
          if (name === 'em') return { fork: () => ({}) }
          throw new Error(`Missing dependency: ${name}`)
        },
      } as never,
    )

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        from: 'notifications@example.com',
        replyTo: 'reply@example.com',
        subject: 'Your Spring Gala ticket is confirmed',
      }),
    )
  })

  it('shows the amount with the currency decimals', async () => {
    findOneWithDecryption
      .mockResolvedValueOnce({
        id: 'txn-2',
        linkId: 'link-2',
        email: 'buyer@example.com',
        firstName: 'Piotr',
        amount: '12.5',
        currencyCode: 'USD',
      })
      .mockResolvedValueOnce({
        id: 'link-2',
        title: 'Spring Gala 2026',
        name: 'Spring Gala 2026',
        successEmailSubject: null,
        successEmailBody: null,
        sendSuccessEmail: true,
      })

    const { default: handle } = await import('../send-email.worker')

    await handle(
      {
        payload: {
          type: 'success',
          transactionId: 'txn-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      {
        resolve: (name: string) => {
          if (name === 'em') return { fork: () => ({}) }
          throw new Error(`Missing dependency: ${name}`)
        },
      } as never,
    )

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ react: expect.objectContaining({ amount: '12.50', currencyCode: 'USD' }) }),
    )
  })
})
