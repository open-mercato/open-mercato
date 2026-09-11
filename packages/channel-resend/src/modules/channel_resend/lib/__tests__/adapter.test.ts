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
