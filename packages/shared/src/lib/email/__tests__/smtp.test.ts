import React from 'react'

const mockSendMail = jest.fn()
const mockCloseTransporter = jest.fn()
const mockCreateTransport = jest.fn()
const mockRender = jest.fn()
const mockWarn = jest.fn()
const mockResendSend = jest.fn()
const mockResendConstructor = jest.fn()

jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }))
jest.mock('@react-email/render', () => ({ render: mockRender }))
jest.mock('resend', () => ({ Resend: mockResendConstructor }))
jest.mock('../../logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

const EMAIL_ENV_VARS = [
  'RESEND_API_KEY',
  'EMAIL_STRATEGY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_SECURE',
  'SMTP_TIMEOUT_MS',
  'OM_ALLOW_INSECURE_SMTP',
  'OM_DISABLE_EMAIL_DELIVERY',
  'OM_TEST_MODE',
  'NOTIFICATIONS_EMAIL_FROM',
  'EMAIL_FROM',
  'ADMIN_EMAIL',
] as const

async function sendTestEmail(overrides: Partial<import('../send').SendEmailOptions> = {}): Promise<void> {
  const { sendEmail } = await import('../send')
  await sendEmail({
    to: 'user@example.com',
    subject: 'Hello',
    react: React.createElement('div', null, 'Hi'),
    ...overrides,
  })
}

describe('sendEmail smtp transport', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    for (const name of EMAIL_ENV_VARS) delete process.env[name]
    process.env.EMAIL_FROM = 'from@example.com'
    mockSendMail.mockReset().mockResolvedValue({})
    mockCloseTransporter.mockReset()
    mockCreateTransport.mockReset().mockImplementation(() => ({
      sendMail: mockSendMail,
      close: mockCloseTransporter,
    }))
    mockRender
      .mockReset()
      .mockImplementation(async (_element: unknown, options?: { plainText?: boolean }) =>
        options?.plainText ? 'text-body' : '<p>html-body</p>',
      )
    mockWarn.mockReset()
    mockResendSend.mockReset().mockResolvedValue({ data: { id: 'email-1' } })
    mockResendConstructor.mockReset().mockImplementation(() => ({ emails: { send: mockResendSend } }))
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('transport resolution', () => {
    it('auto-detects smtp when only SMTP_HOST is set', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'

      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
      expect(mockResendConstructor).not.toHaveBeenCalled()
    })

    it('prefers resend when both RESEND_API_KEY and SMTP_HOST are set', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      process.env.SMTP_HOST = 'smtp.example.com'

      await sendTestEmail()

      expect(mockResendConstructor).toHaveBeenCalledWith('test-key')
      expect(mockCreateTransport).not.toHaveBeenCalled()
    })

    it('EMAIL_STRATEGY=smtp forces smtp despite a configured Resend key', async () => {
      process.env.EMAIL_STRATEGY = 'smtp'
      process.env.RESEND_API_KEY = 'test-key'
      process.env.SMTP_HOST = 'smtp.example.com'

      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
      expect(mockResendConstructor).not.toHaveBeenCalled()
    })

    it('falls back to auto-detection and warns once on an unknown EMAIL_STRATEGY', async () => {
      process.env.EMAIL_STRATEGY = 'pigeon'
      process.env.RESEND_API_KEY = 'test-key'

      await sendTestEmail()
      await sendTestEmail()

      expect(mockResendConstructor).toHaveBeenCalledTimes(2)
      expect(mockWarn).toHaveBeenCalledTimes(1)
      expect(mockWarn.mock.calls[0][1]).toMatchObject({ strategy: 'pigeon' })
    })

    it('throws SMTP_NOT_CONFIGURED when smtp is forced without SMTP_HOST', async () => {
      process.env.EMAIL_STRATEGY = 'smtp'

      await expect(sendTestEmail()).rejects.toThrow('SMTP_NOT_CONFIGURED: set SMTP_HOST')
      expect(mockCreateTransport).not.toHaveBeenCalled()
    })

    it('throws RESEND_API_KEY is not set before the from-address check when nothing is configured', async () => {
      delete process.env.EMAIL_FROM

      await expect(sendTestEmail()).rejects.toThrow('RESEND_API_KEY is not set')
    })
  })

  describe('transporter options', () => {
    it('builds host, port, auth, and timeouts from env', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_PORT = '2525'
      process.env.SMTP_USER = 'mailer'
      process.env.SMTP_PASSWORD = 'secret'
      process.env.SMTP_TIMEOUT_MS = '5000'
      process.env.OM_ALLOW_INSECURE_SMTP = 'true'

      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 2525,
          auth: { user: 'mailer', pass: 'secret' },
          connectionTimeout: 5000,
          socketTimeout: 5000,
        }),
      )
    })

    it('omits auth when credentials are incomplete', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_USER = 'mailer'

      await sendTestEmail()

      const options = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>
      expect(options.auth).toBeUndefined()
    })

    it('defaults SMTP_SECURE to true on port 465 and false otherwise', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_PORT = '465'
      await sendTestEmail()
      expect(mockCreateTransport.mock.calls[0][0]).toMatchObject({ secure: true })

      jest.resetModules()
      process.env.SMTP_PORT = '587'
      await sendTestEmail()
      expect(mockCreateTransport.mock.calls[1][0]).toMatchObject({ secure: false })
    })
  })

  describe('TLS policy', () => {
    it('requires STARTTLS with certificate verification when SMTP_SECURE=false', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_SECURE = 'false'

      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: false,
          requireTLS: true,
          tls: { rejectUnauthorized: true },
        }),
      )
    })

    it('uses implicit TLS with certificate verification when SMTP_SECURE=true', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_SECURE = 'true'

      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: true,
          tls: { rejectUnauthorized: true },
        }),
      )
    })

    it('permits cleartext only behind OM_ALLOW_INSECURE_SMTP and warns once', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_SECURE = 'false'
      process.env.OM_ALLOW_INSECURE_SMTP = 'true'

      await sendTestEmail()
      await sendTestEmail()

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: false,
          requireTLS: false,
          tls: undefined,
        }),
      )
      expect(mockWarn).toHaveBeenCalledTimes(1)
      expect(String(mockWarn.mock.calls[0][0])).toContain('OM_ALLOW_INSECURE_SMTP')
    })

    it('surfaces a refused STARTTLS upgrade as SMTP_SEND_FAILED', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_SECURE = 'false'
      mockSendMail.mockRejectedValueOnce(new Error('STARTTLS command failed'))

      await expect(sendTestEmail()).rejects.toThrow('SMTP_SEND_FAILED: STARTTLS command failed')
    })
  })

  describe('message mapping', () => {
    it('sends rendered html and text with mapped replyTo, from, and attachments', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.OM_ALLOW_INSECURE_SMTP = 'true'

      await sendTestEmail({
        replyTo: 'reply@example.com',
        attachments: [
          { filename: 'invoice.pdf', content: 'dGVzdA==', contentType: 'application/pdf' },
        ],
      })

      expect(mockRender).toHaveBeenCalledTimes(2)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Hello',
          from: 'from@example.com',
          html: '<p>html-body</p>',
          text: 'text-body',
          replyTo: 'reply@example.com',
          attachments: [
            {
              filename: 'invoice.pdf',
              content: 'dGVzdA==',
              encoding: 'base64',
              contentType: 'application/pdf',
            },
          ],
        }),
      )
    })

    it('omits replyTo and attachments when not provided', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'

      await sendTestEmail()

      const message = mockSendMail.mock.calls[0][0] as Record<string, unknown>
      expect(message.replyTo).toBeUndefined()
      expect(message.attachments).toBeUndefined()
    })
  })

  describe('failure handling', () => {
    it('wraps sendMail failures as SMTP_SEND_FAILED and closes the transporter', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      mockSendMail.mockRejectedValueOnce(new Error('connection refused'))

      await expect(sendTestEmail()).rejects.toThrow('SMTP_SEND_FAILED: connection refused')
      expect(mockCloseTransporter).toHaveBeenCalledTimes(1)
    })

    it('closes the transporter after a successful send', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'

      await sendTestEmail()

      expect(mockCloseTransporter).toHaveBeenCalledTimes(1)
    })
  })

  describe('delivery short-circuit', () => {
    it('creates no transporter when email delivery is disabled', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.OM_DISABLE_EMAIL_DELIVERY = '1'

      await sendTestEmail()

      expect(mockCreateTransport).not.toHaveBeenCalled()
      expect(mockSendMail).not.toHaveBeenCalled()
    })
  })
})
