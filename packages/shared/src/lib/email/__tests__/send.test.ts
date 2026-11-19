import React from 'react'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isEmailDeliveryConfigured } from '../config'
import { sendEmail } from '../send'
import {
  clearRegisteredEmailTransportForTests,
  registerEmailTransport,
} from '../transport'

describe('sendEmail', () => {
  const originalEnv = process.env
  let sendMock: jest.Mock
  let tempDir: string | null = null

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMAIL_FROM: 'from@example.com',
    }
    sendMock = jest.fn().mockResolvedValue(undefined)
    clearRegisteredEmailTransportForTests()
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
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
      fromIsInstanceDefault: true,
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

  it('marks an inherited sender so transports can prefer a tenant-configured one', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      fromIsInstanceDefault: true,
    }))
  })

  it('does not mark a sender the caller passed explicitly', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      from: 'chosen@example.com',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'chosen@example.com',
      fromIsInstanceDefault: false,
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

  it('does not let OM_DISABLE_EMAIL_DELIVERY=0 override test-mode delivery suppression', async () => {
    process.env.OM_TEST_MODE = '1'
    process.env.OM_DISABLE_EMAIL_DELIVERY = '0'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('allows test-mode delivery only for the explicitly enabled capture adapter', async () => {
    process.env.OM_TEST_MODE = '1'
    process.env.OM_DISABLE_EMAIL_DELIVERY = '0'
    process.env.OM_ENABLE_TEST_CHANNEL_SEEDING = 'true'
    process.env.OM_ENABLE_TEST_EMAIL_CAPTURE_DELIVERY = 'true'
    process.env.SYSTEM_EMAIL_PROVIDER = '__test_seed__'
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      react: React.createElement('div', null, 'Hi'),
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('captures email links in OM_TEST_MODE without external delivery', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'om-email-capture-'))
    const capturePath = join(tempDir, 'emails.jsonl')
    process.env.OM_TEST_MODE = '1'
    process.env.OM_TEST_EMAIL_CAPTURE_PATH = capturePath
    registerEmailTransport({ id: 'test', send: sendMock })

    await sendEmail({
      to: 'user@example.com',
      subject: 'Invite',
      react: React.createElement('div', null, [
        React.createElement('p', { key: 'text' }, 'Accept your invite'),
        React.createElement('a', { key: 'link', href: 'https://example.com/portal/invite?token=raw' }, 'Accept'),
      ]),
    })

    const rows = (await readFile(capturePath, 'utf8')).trim().split('\n')
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0])).toEqual(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Invite',
      links: ['https://example.com/portal/invite?token=raw'],
      text: 'Accept your invite Accept',
    }))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns every address as accepted when the transport resolves void', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await expect(sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Hi' })).resolves.toEqual({
      accepted: ['user@example.com'],
      rejected: [],
    })
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty('recipients')
  })

  it('passes all recipients in one call to a transport that supports multiple recipients', async () => {
    registerEmailTransport({ id: 'test', send: sendMock, supportsMultipleRecipients: true })

    const result = await sendEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Hello', text: 'Hi' })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: 'a@example.com',
      recipients: ['a@example.com', 'b@example.com'],
    }))
    expect(result.accepted).toEqual(['a@example.com', 'b@example.com'])
  })

  it('refuses a joint multi-recipient send through a transport without the flag', async () => {
    registerEmailTransport({ id: 'test', send: sendMock })

    await expect(sendEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Hello', text: 'Hi' }))
      .rejects.toThrow('EMAIL_TRANSPORT_MULTI_RECIPIENT_UNSUPPORTED')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('fans out one transport call per address when sending separately and merges results', async () => {
    sendMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ accepted: [], rejected: [{ address: 'b@example.com', error: 'mailbox unavailable' }] })
      .mockRejectedValueOnce(new Error('connection reset'))
    registerEmailTransport({ id: 'test', send: sendMock })

    const result = await sendEmail({
      to: ['a@example.com', 'b@example.com', 'c@example.com'],
      sendSeparately: true,
      subject: 'Hello',
      text: 'Hi',
    })

    expect(sendMock).toHaveBeenCalledTimes(3)
    expect(sendMock.mock.calls.map((call) => call[0].to)).toEqual(['a@example.com', 'b@example.com', 'c@example.com'])
    expect(sendMock.mock.calls.every((call) => call[0].recipients === undefined)).toBe(true)
    expect(result).toEqual({
      accepted: ['a@example.com'],
      rejected: [
        { address: 'b@example.com', error: 'mailbox unavailable' },
        { address: 'c@example.com', error: 'connection reset' },
      ],
    })
  })

  it('keeps the latest retryAt reported by the transport', async () => {
    const early = new Date('2026-11-19T10:00:00Z')
    const late = new Date('2026-11-19T11:00:00Z')
    sendMock
      .mockResolvedValueOnce({ accepted: ['a@example.com'], rejected: [], retryAt: early })
      .mockResolvedValueOnce({ accepted: ['b@example.com'], rejected: [], retryAt: late })
    registerEmailTransport({ id: 'test', send: sendMock })

    const result = await sendEmail({ to: ['a@example.com', 'b@example.com'], sendSeparately: true, subject: 'Hello', text: 'Hi' })

    expect(result.retryAt).toEqual(late)
  })

  it('returns partial rejection normally but throws when no address was accepted', async () => {
    sendMock.mockResolvedValueOnce({
      accepted: ['a@example.com'],
      rejected: [{ address: 'b@example.com', error: 'rejected' }],
    })
    registerEmailTransport({ id: 'test', send: sendMock, supportsMultipleRecipients: true })
    await expect(sendEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Hello', text: 'Hi' }))
      .resolves.toEqual({ accepted: ['a@example.com'], rejected: [{ address: 'b@example.com', error: 'rejected' }] })

    sendMock.mockResolvedValueOnce({ accepted: [], rejected: [{ address: 'user@example.com', error: 'rejected' }] })
    await expect(sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Hi' }))
      .rejects.toThrow('EMAIL_SEND_REJECTED: user@example.com: rejected')
  })

  it('propagates a transport error on a joint send', async () => {
    sendMock.mockRejectedValueOnce(new Error('SMTP_SEND_FAILED: down'))
    registerEmailTransport({ id: 'test', send: sendMock })

    await expect(sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Hi' })).rejects.toThrow('SMTP_SEND_FAILED: down')
  })

  it('captures every address in OM_TEST_MODE for joint and separate sends', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'om-email-capture-'))
    const capturePath = join(tempDir, 'emails.jsonl')
    process.env.OM_TEST_MODE = '1'
    process.env.OM_TEST_EMAIL_CAPTURE_PATH = capturePath
    registerEmailTransport({ id: 'test', send: sendMock })

    await expect(sendEmail({ to: ['a@example.com', 'b@example.com'], subject: 'Joint', text: 'Hi' }))
      .resolves.toEqual({ accepted: ['a@example.com', 'b@example.com'], rejected: [] })
    await sendEmail({ to: ['c@example.com', 'd@example.com'], sendSeparately: true, subject: 'Separate', text: 'Hi' })

    const rows = (await readFile(capturePath, 'utf8')).trim().split('\n').map((row) => JSON.parse(row))
    expect(rows.map((row) => [row.subject, row.to, row.recipients])).toEqual([
      ['Joint', 'a@example.com', ['a@example.com', 'b@example.com']],
      ['Separate', 'c@example.com', ['c@example.com']],
      ['Separate', 'd@example.com', ['d@example.com']],
    ])
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('reports configured only when a sender and configured transport are present', () => {
    expect(isEmailDeliveryConfigured()).toBe(false)

    registerEmailTransport({ id: 'test', send: sendMock, isConfigured: () => false })
    expect(isEmailDeliveryConfigured()).toBe(false)

    registerEmailTransport({ id: 'test', send: sendMock, isConfigured: () => true })
    expect(isEmailDeliveryConfigured()).toBe(true)
  })
})
