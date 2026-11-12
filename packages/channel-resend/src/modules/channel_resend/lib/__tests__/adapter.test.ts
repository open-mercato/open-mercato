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
  beforeEach(() => {
    sendMock.mockClear()
    ResendMock.mockClear()
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
