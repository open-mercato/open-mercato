import React from 'react'
import { sendEmail } from '../send'
import { isEmailDeliveryConfigured, resolveAwsSesRegion, resolveEmailProvider } from '../config'

var sendMock: jest.Mock
var ResendMock: jest.Mock
var sendMailMock: jest.Mock
var createTransportMock: jest.Mock
var SESv2ClientMock: jest.Mock
var SendEmailCommandMock: jest.Mock

jest.mock('resend', () => {
  sendMock = jest.fn().mockResolvedValue({ data: { id: 'email-1' } })
  ResendMock = jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  }))

  return { Resend: ResendMock }
})

jest.mock('nodemailer', () => {
  sendMailMock = jest.fn().mockResolvedValue({ messageId: 'ses-email-1' })
  createTransportMock = jest.fn().mockReturnValue({ sendMail: sendMailMock })
  return { __esModule: true, default: { createTransport: createTransportMock } }
})

jest.mock('@aws-sdk/client-sesv2', () => {
  SESv2ClientMock = jest.fn()
  SendEmailCommandMock = jest.fn()
  return {
    SESv2Client: SESv2ClientMock,
    SendEmailCommand: SendEmailCommandMock,
  }
})

describe('sendEmail', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 'test-key',
      EMAIL_FROM: 'from@example.com',
    }
    sendMock.mockClear()
    ResendMock.mockClear()
    sendMailMock?.mockClear()
    createTransportMock?.mockClear()
    SESv2ClientMock?.mockClear()
    SendEmailCommandMock?.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('maps replyTo to reply_to in Resend payload', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
      replyTo: 'reply@example.com',
    })

    expect(ResendMock).toHaveBeenCalledWith('test-key')
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        reply_to: 'reply@example.com',
      })
    )
  })

  it('omits reply_to when replyTo is not provided', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    const payload = sendMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toBeDefined()
    expect(payload.reply_to).toBeUndefined()
  })

  it('passes attachments to Resend payload when provided', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'dGVzdA==',
          contentType: 'application/pdf',
        },
      ],
    })

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: 'invoice.pdf',
            content: 'dGVzdA==',
            contentType: 'application/pdf',
          },
        ],
      })
    )
  })

  it('throws when Resend returns an error', async () => {
    sendMock.mockResolvedValueOnce({ error: { message: 'invalid domain' } })

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('RESEND_SEND_FAILED: invalid domain')
  })

  it('falls back to NOTIFICATIONS_EMAIL_FROM when EMAIL_FROM is not set', async () => {
    delete process.env.EMAIL_FROM
    process.env.NOTIFICATIONS_EMAIL_FROM = 'notifications@example.com'

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'notifications@example.com',
      })
    )
  })

  it('falls back to ADMIN_EMAIL when sender-specific env vars are not set', async () => {
    delete process.env.EMAIL_FROM
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    process.env.ADMIN_EMAIL = 'admin@example.com'

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'admin@example.com',
      })
    )
  })

  it('throws a clear error when no sender address is configured', async () => {
    delete process.env.EMAIL_FROM
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    delete process.env.ADMIN_EMAIL

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('EMAIL_FROM_NOT_CONFIGURED')
  })

  it('skips external delivery in test mode when email delivery is disabled', async () => {
    process.env.OM_DISABLE_EMAIL_DELIVERY = '1'
    delete process.env.RESEND_API_KEY

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(ResendMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('uses Resend explicitly when EMAIL_PROVIDER is resend', async () => {
    process.env.EMAIL_PROVIDER = 'resend'

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(resolveEmailProvider()).toBe('resend')
    expect(ResendMock).toHaveBeenCalledWith('test-key')
    expect(createTransportMock).toBeUndefined()
  })

  it('uses SES transport when EMAIL_PROVIDER is ses', async () => {
    process.env.EMAIL_PROVIDER = 'ses'
    process.env.AWS_SES_REGION = 'eu-west-2'
    delete process.env.RESEND_API_KEY

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
      replyTo: 'reply@example.com',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'dGVzdA==',
          contentType: 'application/pdf',
        },
      ],
    })

    expect(resolveEmailProvider()).toBe('ses')
    expect(resolveAwsSesRegion()).toBe('eu-west-2')
    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'eu-west-2' })
    expect(createTransportMock).toHaveBeenCalledWith({
      SES: {
        sesClient: expect.any(Object),
        SendEmailCommand: SendEmailCommandMock,
      },
    })
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        html: expect.stringContaining('Hi'),
        text: expect.stringContaining('Hi'),
        replyTo: 'reply@example.com',
        attachments: [
          {
            filename: 'invoice.pdf',
            content: 'dGVzdA==',
            encoding: 'base64',
            contentType: 'application/pdf',
          },
        ],
      })
    )
    expect(ResendMock).not.toHaveBeenCalled()
  })

  it('falls back to AWS_REGION for SES region', async () => {
    process.env.EMAIL_PROVIDER = 'ses'
    process.env.AWS_REGION = 'eu-central-1'
    delete process.env.AWS_SES_REGION

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'eu-central-1' })
  })

  it('allows the AWS SDK to resolve region when SES region env vars are not set', async () => {
    process.env.EMAIL_PROVIDER = 'ses'
    delete process.env.AWS_REGION
    delete process.env.AWS_SES_REGION

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(SESv2ClientMock).toHaveBeenCalledWith({})
  })

  it('throws a provider-specific error when SES sending fails', async () => {
    process.env.EMAIL_PROVIDER = 'ses'
    await import('nodemailer')
    sendMailMock.mockRejectedValueOnce(new Error('message rejected'))

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('SES_SEND_FAILED: message rejected')
  })

  it('throws a clear error when EMAIL_PROVIDER is unsupported', async () => {
    process.env.EMAIL_PROVIDER = 'smtp'

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('EMAIL_PROVIDER_UNSUPPORTED: smtp')
  })

  it('reports email delivery as configured for Resend when API key and sender exist', () => {
    expect(isEmailDeliveryConfigured()).toBe(true)
  })

  it('reports email delivery as configured for SES when sender exists', () => {
    process.env.EMAIL_PROVIDER = 'ses'
    delete process.env.RESEND_API_KEY

    expect(isEmailDeliveryConfigured()).toBe(true)
  })

  it('reports email delivery as not configured when sender is missing', () => {
    delete process.env.EMAIL_FROM
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    delete process.env.ADMIN_EMAIL

    expect(isEmailDeliveryConfigured()).toBe(false)
  })

  it('reports email delivery as not configured when disabled', () => {
    process.env.OM_DISABLE_EMAIL_DELIVERY = 'true'

    expect(isEmailDeliveryConfigured()).toBe(false)
  })

  it('reports email delivery as not configured when provider is unsupported', () => {
    process.env.EMAIL_PROVIDER = 'smtp'

    expect(isEmailDeliveryConfigured()).toBe(false)
  })
})
