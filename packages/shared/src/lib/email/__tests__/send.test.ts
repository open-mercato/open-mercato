import React from 'react'
import { isEmailDeliveryConfigured } from '../config'
import { sendEmail } from '../send'
import {
  clearRegisteredEmailTransportForTests,
  registerEmailTransport,
} from '../transport'

describe('sendEmail', () => {
  const originalEnv = process.env
  let sendMock: jest.Mock

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMAIL_FROM: 'from@example.com',
    }
    sendMock = jest.fn().mockResolvedValue(undefined)
    clearRegisteredEmailTransportForTests()
  })

  afterEach(() => {
    process.env = originalEnv
    clearRegisteredEmailTransportForTests()
  })

  it('delegates normalized payloads to the registered transport', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
      replyTo: 'reply@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'dGVzdA==',
          contentType: 'application/pdf',
        },
      ],
    })

    expect(sendMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      react: expect.any(Object),
      html: undefined,
      text: undefined,
      replyTo: 'reply@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'dGVzdA==',
          contentType: 'application/pdf',
        },
      ],
    })
  })

  it('delegates html and text bodies without provider-specific rendering', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      html: '<p>Hello</p>',
      text: 'Hello',
    }))
  })

  it('falls back to NOTIFICATIONS_EMAIL_FROM when EMAIL_FROM is not set', async () => {
    delete process.env.EMAIL_FROM
    process.env.NOTIFICATIONS_EMAIL_FROM = 'notifications@example.com'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'notifications@example.com',
    }))
  })

  it('falls back to ADMIN_EMAIL when sender-specific env vars are not set', async () => {
    delete process.env.EMAIL_FROM
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    process.env.ADMIN_EMAIL = 'admin@example.com'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'admin@example.com',
    }))
  })

  it('throws a clear error when no sender address is configured', async () => {
    delete process.env.EMAIL_FROM
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    delete process.env.ADMIN_EMAIL
    registerEmailTransport({ id: 'test', send: sendMock })

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('EMAIL_FROM_NOT_CONFIGURED')
  })

  it('throws a clear error when no transport is registered', async () => {
    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })).rejects.toThrow('EMAIL_TRANSPORT_NOT_CONFIGURED')
  })

  it('skips transport delivery when email delivery is disabled', async () => {
    process.env.OM_DISABLE_EMAIL_DELIVERY = 'yes'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('keeps the established boolean tokens for test-mode delivery suppression', async () => {
    process.env.OM_TEST_MODE = 'on'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('lets explicit OM_DISABLE_EMAIL_DELIVERY=0 override test-mode delivery suppression', async () => {
    process.env.OM_TEST_MODE = '1'
    process.env.OM_DISABLE_EMAIL_DELIVERY = '0'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('reports configured only when a sender and configured transport are present', () => {
    expect(isEmailDeliveryConfigured()).toBe(false)

    registerEmailTransport({ id: 'test', send: sendMock, isConfigured: () => false })
    expect(isEmailDeliveryConfigured()).toBe(false)

    registerEmailTransport({ id: 'test', send: sendMock, isConfigured: () => true })
    expect(isEmailDeliveryConfigured()).toBe(true)
  })
})
