import { getSmtpChannelAdapter } from '../adapter'
import { setSmtpTransport, type SmtpConnection, type SmtpMessage, type SmtpTransport } from '../transport'

const credentials = {
  host: 'smtp.example.com',
  port: 587,
  tls: 'starttls',
  user: 'mailer',
  password: 'secret',
  fromAddress: 'no-reply@example.com',
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

type Sent = { connection: SmtpConnection; message: SmtpMessage }

function stubTransport(overrides: Partial<SmtpTransport> = {}): { sent: Sent[] } {
  const sent: Sent[] = []
  setSmtpTransport({
    async send(connection, message) {
      sent.push({ connection, message })
      return { messageId: '<generated@example.com>', response: '250 OK' }
    },
    async verify() {},
    ...overrides,
  })
  return { sent }
}

describe('SmtpChannelAdapter.sendMessage', () => {
  afterEach(() => setSmtpTransport(null))

  it('sends HTML and text through the relay and reports the provider message id', async () => {
    const { sent } = stubTransport()
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      conversationId: 'conv-1',
      content: { text: 'Hello', html: '<p>Hello</p>' },
      metadata: { to: ['someone@example.com'], subject: 'Welcome' },
    })

    expect(result).toEqual(expect.objectContaining({
      externalMessageId: '<generated@example.com>',
      conversationId: 'conv-1',
      status: 'sent',
      metadata: { response: '250 OK' },
    }))
    expect(sent).toHaveLength(1)
    expect(sent[0].connection).toEqual(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
      tls: 'starttls',
      user: 'mailer',
      password: 'secret',
    }))
    expect(sent[0].message).toEqual(expect.objectContaining({
      from: 'no-reply@example.com',
      to: ['someone@example.com'],
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
    }))
  })

  it('prefers an explicit from and forwards replyTo and base64 attachments', async () => {
    const { sent } = stubTransport()
    await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: {
        to: ['someone@example.com'],
        subject: 'Invoice',
        from: 'billing@example.com',
        replyTo: 'support@example.com',
        attachments: [{ filename: 'invoice.pdf', content: 'JVBERi0=', contentType: 'application/pdf' }],
      },
    })

    expect(sent[0].message).toEqual(expect.objectContaining({
      from: 'billing@example.com',
      replyTo: 'support@example.com',
      attachments: [{
        filename: 'invoice.pdf',
        content: 'JVBERi0=',
        encoding: 'base64',
        contentType: 'application/pdf',
      }],
    }))
  })

  it('accepts the raw recipient string the hub test-send route passes straight to sendMessage', async () => {
    const { sent } = stubTransport()
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Test message from Open Mercato' },
      metadata: { to: 'someone@example.com', subject: 'Test send', testSend: true },
    })

    expect(result.status).toBe('sent')
    expect(sent[0].message.to).toEqual(['someone@example.com'])
  })

  it('splits the comma-separated recipient form system email supports', async () => {
    const { sent } = stubTransport()
    await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: { to: 'one@example.com, two@example.com', subject: 'Welcome' },
    })

    expect(sent[0].message.to).toEqual(['one@example.com', 'two@example.com'])
  })

  it('reports a partial recipient rejection as failed, keeping the message id and the split', async () => {
    stubTransport({
      async send() {
        return {
          messageId: '<partial@example.com>',
          response: '250 OK',
          accepted: ['one@example.com'],
          rejected: ['two@example.com'],
        }
      },
    })
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: { to: 'one@example.com, two@example.com', subject: 'Welcome' },
    })

    expect(result.status).toBe('failed')
    expect(result.externalMessageId).toBe('<partial@example.com>')
    expect(result.error).toContain('two@example.com')
    expect(result.metadata).toEqual(expect.objectContaining({
      accepted: ['one@example.com'],
      rejected: ['two@example.com'],
    }))
  })

  it('reports a fully accepted multi-recipient send as sent and carries the accepted list', async () => {
    stubTransport({
      async send() {
        return {
          messageId: '<all@example.com>',
          response: '250 OK',
          accepted: ['one@example.com', 'two@example.com'],
          rejected: [],
        }
      },
    })
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: { to: ['one@example.com', 'two@example.com'], subject: 'Welcome' },
    })

    expect(result.status).toBe('sent')
    expect(result.metadata).toEqual(expect.objectContaining({
      accepted: ['one@example.com', 'two@example.com'],
    }))
    expect(result.metadata).not.toHaveProperty('rejected')
  })

  it('fails without sending when there is no recipient or no subject', async () => {
    const { sent } = stubTransport()
    const adapter = getSmtpChannelAdapter()

    const noRecipient = await adapter.sendMessage({
      credentials, scope, content: { text: 'Body' }, metadata: { subject: 'Hi' },
    })
    const noSubject = await adapter.sendMessage({
      credentials, scope, content: { text: 'Body' }, metadata: { to: ['a@example.com'] },
    })

    expect(noRecipient.status).toBe('failed')
    expect(noSubject.status).toBe('failed')
    expect(sent).toHaveLength(0)
  })

  it('reports a relay failure as a failed result rather than throwing', async () => {
    stubTransport({
      async send() {
        throw new Error('535 Authentication credentials invalid')
      },
    })
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: { to: ['someone@example.com'], subject: 'Welcome' },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('SMTP_SEND_FAILED: 535 Authentication credentials invalid')
  })

  it('refuses to send with credentials the schema rejects', async () => {
    stubTransport()
    await expect(getSmtpChannelAdapter().sendMessage({
      credentials: { ...credentials, host: '169.254.169.254' },
      scope,
      content: { text: 'Body' },
      metadata: { to: ['someone@example.com'], subject: 'Welcome' },
    })).rejects.toThrow()
  })

  it('synthesises an id when the relay returns none, so the hub always has a handle', async () => {
    stubTransport({ async send() { return {} } })
    const result = await getSmtpChannelAdapter().sendMessage({
      credentials,
      scope,
      content: { text: 'Body' },
      metadata: { to: ['someone@example.com'], subject: 'Welcome' },
    })
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toMatch(/^smtp:\d+$/)
  })
})

describe('SmtpChannelAdapter outbound-only surface', () => {
  it('acknowledges webhooks without claiming verification', async () => {
    const inbound = await getSmtpChannelAdapter().verifyWebhook({
      rawBody: '', headers: {}, credentials, scope,
    })
    expect(inbound.eventType).toBe('other')
  })

  it('refuses to normalize inbound mail', async () => {
    await expect(getSmtpChannelAdapter().normalizeInbound({ raw: {} })).rejects.toThrow(/outbound-only/)
  })

  it('derives a text alternative from an HTML body in convertOutbound', async () => {
    const native = await getSmtpChannelAdapter().convertOutbound({
      body: '<p>Hello</p>',
      bodyFormat: 'html',
      channelMetadata: { to: 'someone@example.com', subject: 'Welcome' },
    })
    expect(native.content.html).toBe('<p>Hello</p>')
    expect(native.content.text).toContain('Hello')
    expect(native.metadata).toEqual(expect.objectContaining({
      to: ['someone@example.com'],
      subject: 'Welcome',
    }))
  })
})
