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
    process.env = { ...originalEnv }
    sendMailMock.mockClear()
    createTransportMock.mockClear()
    SESv2ClientMock.mockClear()
    SendEmailCommandMock.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
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

  it('falls back to AWS_SES_REGION when credentials omit region', async () => {
    process.env.AWS_SES_REGION = 'us-east-1'
    const adapter = getSesChannelAdapter()

    await adapter.sendMessage({
      content: { text: 'Hello' },
      credentials: { fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'us-east-1' })
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
