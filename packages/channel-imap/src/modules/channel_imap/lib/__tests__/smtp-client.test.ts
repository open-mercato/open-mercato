import { generateMessageId, getSmtpClient, setSmtpClient, type SmtpConnectionOptions } from '../smtp-client'

const sendMail = jest.fn(async (_options: { messageId?: string }) => ({
  messageId: '<server@example.com>' as string | undefined,
  response: '250 OK',
}))
const close = jest.fn()

jest.mock('nodemailer', () => ({
  __esModule: true,
  createTransport: jest.fn(() => ({ sendMail, close, verify: jest.fn(async () => true) })),
}))

jest.mock('../host-pinning', () => ({
  resolveSafeHostAddress: jest.fn(async (host: string) => ({ host: '93.184.216.34', servername: host })),
}))

jest.mock('../transport', () => ({ assertTransportAllowed: jest.fn() }))

const connection: SmtpConnectionOptions = {
  host: 'smtp.example.com',
  port: 587,
  transport: 'starttls',
  user: 'user@example.com',
  pass: 'secret',
}

describe('NodemailerClient.send — RFC2822 capture for the Sent-folder append', () => {
  afterEach(() => {
    setSmtpClient(null)
    jest.clearAllMocks()
  })

  // Regression (#6757): nodemailer 10 dropped the root `MailComposer` re-export.
  // The resolver falls back to the `nodemailer/lib/mail-composer` subpath; without
  // it `raw` silently stays empty and the Sent-folder append uploads 0 bytes.
  it('returns non-empty RFC2822 bytes even though nodemailer exposes no root MailComposer', async () => {
    const result = await getSmtpClient().send(connection, {
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'Sent folder append',
      text: 'body',
    })

    expect(result.raw.length).toBeGreaterThan(0)
    const raw = result.raw.toString('utf8')
    expect(raw).toContain('Subject: Sent folder append')
    expect(raw).toContain('recipient@example.com')
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prefers the composed Message-ID when the caller supplies one', async () => {
    const result = await getSmtpClient().send(connection, {
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'With id',
      text: 'body',
      messageId: '<caller@example.com>',
    })

    expect(result.raw.toString('utf8')).toContain('<caller@example.com>')
    expect(result.messageId).toBe('<server@example.com>')
  })

  // Regression (#7101): without a caller id, MailComposer and sendMail each generated
  // their own Message-ID, so the Sent-folder copy did not match the delivered message.
  it('uses one generated Message-ID for the Sent copy and the delivered message', async () => {
    sendMail.mockImplementationOnce(async (options: { messageId?: string }) => ({
      messageId: options.messageId,
      response: '250 OK',
    }))

    const result = await getSmtpClient().send(connection, {
      from: 'Support Team <support@mail.example.com>',
      to: ['recipient@example.com'],
      subject: 'No caller id',
      text: 'body',
    })

    const sentOptions = sendMail.mock.calls[0][0]
    expect(sentOptions.messageId).toMatch(/^<[0-9a-f-]{36}@mail\.example\.com>$/)
    expect(result.raw.toString('utf8')).toContain(`Message-ID: ${sentOptions.messageId}`)
    expect(result.messageId).toBe(sentOptions.messageId)
  })
})

describe('generateMessageId', () => {
  it('derives the domain from a bare or display-name sender address', () => {
    expect(generateMessageId('a@example.org')).toMatch(/^<[0-9a-f-]{36}@example\.org>$/)
    expect(generateMessageId('"Ops" <ops@example.net>')).toMatch(/^<[0-9a-f-]{36}@example\.net>$/)
  })

  it('falls back to localhost when the sender has no domain', () => {
    expect(generateMessageId('nobody')).toMatch(/^<[0-9a-f-]{36}@localhost>$/)
  })

  it('generates a distinct id per call', () => {
    expect(generateMessageId('a@example.org')).not.toBe(generateMessageId('a@example.org'))
  })
})
