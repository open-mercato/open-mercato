import { getResendChannelAdapter } from '../adapter'

var sendMock: jest.Mock
var ResendMock: jest.Mock

jest.mock('resend', () => {
  sendMock = jest.fn().mockResolvedValue({ data: { id: 'email-1' } })
  ResendMock = jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  }))
  return { Resend: ResendMock }
})

describe('ResendChannelAdapter', () => {
  const originalEnv = process.env

  afterEach(() => { process.env = originalEnv })

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.RESEND_API_KEY
    sendMock.mockClear()
    ResendMock.mockClear()
  })

  it.each([
    undefined,
    'security@example.com',
    'approved@example.com, security@example.com',
    'Security <security@example.com>',
    'approved@example.com\r\nFrom: security@example.com',
  ])('pins the final From to the operator sender despite override %s', async (from) => {
    process.env.NOTIFICATIONS_EMAIL_FROM = 'approved@example.com'
    process.env.RESEND_API_KEY = ' operator-key '
    const adapter = getResendChannelAdapter()
    const converted = await adapter.convertOutbound({
      body: 'Body',
      bodyFormat: 'text',
      channelMetadata: { to: 'recipient@example.com', subject: 'Hello', from },
    })
    const result = await adapter.sendMessage({
      credentials: { apiKey: 'operator-key', fromAddress: 'forged@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      content: converted.content,
      metadata: converted.metadata,
    })

    expect(result.status).toBe('sent')
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'approved@example.com' }))
  })

  it.each([undefined, 'invalid', 'one@example.com, two@example.com'])('fails closed with operator credentials and invalid operator sender %s', async (from) => {
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    delete process.env.EMAIL_FROM
    delete process.env.ADMIN_EMAIL
    if (from !== undefined) process.env.EMAIL_FROM = from
    process.env.RESEND_API_KEY = 'operator-key'
    const result = await getResendChannelAdapter().sendMessage({
      credentials: { apiKey: 'operator-key', fromAddress: 'forged@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      content: { text: 'Body' },
      metadata: { to: 'recipient@example.com', subject: 'Hello', from: 'forged@example.com' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Operator email sender is not configured or invalid',
    }))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it.each([undefined, 'billing@tenant.example'])('retains tenant-owned credential sender selection for override %s', async (from) => {
    process.env.NOTIFICATIONS_EMAIL_FROM = 'operator@example.com'
    process.env.RESEND_API_KEY = 'different-operator-key'
    
    const result = await getResendChannelAdapter().sendMessage({
      credentials: { apiKey: 'operator-key', fromAddress: 'forged@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      content: { text: 'Body' },
      metadata: { to: 'recipient@example.com', subject: 'Hello', from },
    })

    expect(result.status).toBe('sent')
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: from ?? 'forged@example.com' }))
  })

  it('sends html email with replyTo and attachments', async () => {
    const adapter = getResendChannelAdapter()
    const converted = await adapter.convertOutbound({
      body: '<p>Hello</p>',
      bodyFormat: 'html',
      channelMetadata: {
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        replyTo: 'reply@example.com',
        attachments: [{ filename: 'a.txt', content: 'dGVzdA==', contentType: 'text/plain' }],
      },
    })

    const result = await adapter.sendMessage({
      content: converted.content,
      credentials: { apiKey: 'key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: converted.metadata,
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: 'email-1' }))
    expect(ResendMock).toHaveBeenCalledWith('key')
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'from@example.com',
      to: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      replyTo: 'reply@example.com',
      attachments: [{ filename: 'a.txt', content: 'dGVzdA==', contentType: 'text/plain' }],
    }))
  })

  it('accepts the raw recipient string a direct sendMessage caller passes', async () => {
    const adapter = getResendChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Test send' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: 'user@example.com', subject: 'Test send', testSend: true },
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: 'email-1' }))
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['user@example.com'] }))
  })

  it('splits a comma or semicolon separated recipient string', async () => {
    const adapter = getResendChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: 'a@example.com, b@example.com;c@example.com', subject: 'Hello' },
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: ['a@example.com', 'b@example.com', 'c@example.com'],
    }))
  })

  it('rejects an empty recipient string without calling Resend', async () => {
    const adapter = getResendChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: '  ', subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires at least one recipient',
    }))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('strips CR/LF from subject, from and replyTo before calling Resend', async () => {
    const adapter = getResendChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: 'user@example.com',
        subject: 'Hello\r\nBcc: attacker@example.test',
        from: 'from@example.com\r\nBcc: attacker@example.test',
        replyTo: 'reply@example.com\nX-Injected: yes',
      },
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent' }))
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Hello Bcc: attacker@example.test',
      from: 'from@example.com Bcc: attacker@example.test',
      replyTo: 'reply@example.com X-Injected: yes',
    }))
  })

  it('returns CR/LF-free subject, from and replyTo from convertOutbound', async () => {
    const adapter = getResendChannelAdapter()

    const converted = await adapter.convertOutbound({
      body: 'Hello',
      bodyFormat: 'text',
      channelMetadata: {
        to: 'user@example.com',
        subject: 'Hello\r\nBcc: attacker@example.test',
        from: 'from@example.com\r\nBcc: attacker@example.test',
        replyTo: 'reply@example.com\r\nX-Injected: yes',
      },
    })

    expect(converted.metadata).toEqual(expect.objectContaining({
      subject: 'Hello Bcc: attacker@example.test',
      from: 'from@example.com Bcc: attacker@example.test',
      replyTo: 'reply@example.com X-Injected: yes',
    }))
  })

  it('strips CR/LF from attachment filename and contentType', async () => {
    const adapter = getResendChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: 'user@example.com',
        subject: 'Hello',
        attachments: [{ filename: 'a.txt\r\nX-Injected: yes', content: 'dGVzdA==', contentType: 'text/plain\r\nX-Injected: yes' }],
      },
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: 'a.txt X-Injected: yes', content: 'dGVzdA==', contentType: 'text/plain X-Injected: yes' }],
    }))
  })

  it('still rejects a subject made only of CR/LF without calling Resend', async () => {
    const adapter = getResendChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: 'user@example.com', subject: '\r\n' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires a subject',
    }))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns a failed result when Resend reports an error', async () => {
    sendMock.mockResolvedValueOnce({ error: { message: 'bad domain' } })
    const adapter = getResendChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'RESEND_SEND_FAILED: bad domain',
    }))
  })
})
