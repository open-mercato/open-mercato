import React from 'react'
import { sendEmail } from '../send'

const sendMock = jest.fn().mockResolvedValue({ id: 'email-1' })
const ResendMock = jest.fn().mockImplementation(() => ({
  emails: { send: sendMock },
}))

jest.mock('resend', () => ({
  Resend: ResendMock,
}))

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
})
