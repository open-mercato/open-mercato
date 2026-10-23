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

  it('carries RFC 8058 one-click unsubscribe headers from channelMetadata to Resend', async () => {
    const adapter = getResendChannelAdapter()
    const converted = await adapter.convertOutbound({
      body: 'Hello',
      bodyFormat: 'text',
      channelMetadata: {
        to: 'user@example.com',
        subject: 'Hello',
        headers: {
          'List-Unsubscribe': '<https://example.com/unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      },
    })

    await adapter.sendMessage({
      content: converted.content,
      credentials: { apiKey: 'key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: converted.metadata,
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        'List-Unsubscribe': '<https://example.com/unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }))
  })

  it('collapses CR/LF in a header value instead of forwarding the injection attempt', async () => {
    const adapter = getResendChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: ['user@example.com'],
        subject: 'Hello',
        headers: { 'X-Campaign': "legit\r\nBcc: attacker@example.com" },
      },
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: { 'X-Campaign': 'legit Bcc: attacker@example.com' },
    }))
  })

  it('drops a header name that is not a plain token', async () => {
    const adapter = getResendChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: ['user@example.com'],
        subject: 'Hello',
        headers: { 'Bad Name: injected': 'value' },
      },
    })

    expect(sendMock).toHaveBeenCalledWith(expect.not.objectContaining({ headers: expect.anything() }))
  })

  it('drops a non-string header value', async () => {
    const adapter = getResendChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: ['user@example.com'],
        subject: 'Hello',
        headers: { 'X-Count': 42 },
      },
    })

    expect(sendMock).toHaveBeenCalledWith(expect.not.objectContaining({ headers: expect.anything() }))
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
