import React from 'react'
import { sendEmail } from '../send'

var sendMock: jest.Mock
var ResendMock: jest.Mock

jest.mock('resend', () => {
  sendMock = jest.fn().mockResolvedValue({ data: { id: 'email-1' } })
  ResendMock = jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  }))

  return { Resend: ResendMock }
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
})
