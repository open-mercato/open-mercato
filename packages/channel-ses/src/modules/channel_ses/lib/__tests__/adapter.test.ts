import { getSesChannelAdapter } from '../adapter'

var sendMailMock: jest.Mock
var createTransportMock: jest.Mock
var SESv2ClientMock: jest.Mock
var SendEmailCommandMock: jest.Mock

jest.mock('nodemailer', () => {
  sendMailMock = jest.fn().mockResolvedValue({ messageId: 'ses-1', response: 'ok' })
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

describe('SesChannelAdapter', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, NOTIFICATIONS_EMAIL_FROM: 'from@example.com' }
    sendMailMock.mockClear()
    createTransportMock.mockClear()
    SESv2ClientMock.mockClear()
    SendEmailCommandMock.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it.each([
    undefined,
    'security@example.com',
    'approved@example.com, security@example.com',
    'Security <security@example.com>',
    'approved@example.com\r\nFrom: security@example.com',
  ])('pins the final From to the operator sender despite override %s', async (from) => {
    process.env.NOTIFICATIONS_EMAIL_FROM = 'approved@example.com'
    const adapter = getSesChannelAdapter()
    const converted = await adapter.convertOutbound({
      body: 'Body',
      bodyFormat: 'text',
      channelMetadata: { to: 'recipient@example.com', subject: 'Hello', from },
    })
    const result = await adapter.sendMessage({
      credentials: { region: 'eu-west-2', fromAddress: 'forged@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      content: converted.content,
      metadata: converted.metadata,
    })

    expect(result.status).toBe('sent')
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'approved@example.com' }))
  })

  it.each([undefined, 'invalid', 'one@example.com, two@example.com'])('fails closed with operator credentials and invalid operator sender %s', async (from) => {
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    delete process.env.EMAIL_FROM
    delete process.env.ADMIN_EMAIL
    if (from !== undefined) process.env.EMAIL_FROM = from
    const result = await getSesChannelAdapter().sendMessage({
      credentials: { region: 'eu-west-2', fromAddress: 'forged@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      content: { text: 'Body' },
      metadata: { to: 'recipient@example.com', subject: 'Hello', from: 'forged@example.com' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Operator email sender is not configured or invalid',
    }))
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('sends html email through Nodemailer SES transport', async () => {
    const adapter = getSesChannelAdapter()
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
      credentials: {
        region: 'eu-west-2',
        fromAddress: 'fallback@example.com',
        configurationSetName: 'default',
      },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: converted.metadata,
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: 'ses-1' }))
    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'eu-west-2' })
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ SES: expect.any(Object) }))
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'from@example.com',
      to: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      replyTo: 'reply@example.com',
      attachments: [{ filename: 'a.txt', content: 'dGVzdA==', encoding: 'base64', contentType: 'text/plain' }],
      ses: { ConfigurationSetName: 'default' },
    }))
  })

  it('accepts the raw recipient string a direct sendMessage caller passes', async () => {
    const adapter = getSesChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Test send' },
      credentials: { region: 'eu-west-2', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: 'user@example.com', subject: 'Test send', testSend: true },
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: 'ses-1' }))
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['user@example.com'] }))
  })

  it('splits a comma or semicolon separated recipient string', async () => {
    const adapter = getSesChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { region: 'eu-west-2', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: 'a@example.com, b@example.com;c@example.com', subject: 'Hello' },
    })

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: ['a@example.com', 'b@example.com', 'c@example.com'],
    }))
  })

  it('rejects an empty recipient string without calling the SES transport', async () => {
    const adapter = getSesChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { region: 'eu-west-2', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: '  ', subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires at least one recipient',
    }))
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('returns a failed result when the SES transport rejects', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('temporary outage'))
    const adapter = getSesChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { region: 'eu-west-2', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'SES_SEND_FAILED: temporary outage',
    }))
  })
})
