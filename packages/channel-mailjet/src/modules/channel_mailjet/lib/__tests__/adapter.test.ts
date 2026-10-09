import { getMailjetChannelAdapter } from '../adapter'

describe('MailjetChannelAdapter', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      Messages: [{ Status: 'success', To: [{ MessageID: 12345 }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('maps html, text, reply-to, recipients, and attachments to Send API v3.1', async () => {
    const result = await getMailjetChannelAdapter().sendMessage({
      content: { html: '<p>Hello</p>', text: 'Hello', bodyFormat: 'html' },
      credentials: { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: 'a@example.com;b@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        replyTo: 'reply@example.com',
        attachments: [{ filename: 'a.txt', content: 'dGVzdA==', contentType: 'text/plain' }],
      },
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: '12345' }))
    const request = (global.fetch as jest.Mock).mock.calls[0]
    expect(request[0]).toBe('https://api.mailjet.com/v3.1/send')
    expect(request[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from('public-key:private-key').toString('base64')}`,
      }),
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.parse(String(request[1].body))).toEqual({
      Messages: [{
        From: { Email: 'from@example.com' },
        To: [{ Email: 'a@example.com' }, { Email: 'b@example.com' }],
        Subject: 'Hello',
        HTMLPart: '<p>Hello</p>',
        TextPart: 'Hello',
        ReplyTo: { Email: 'reply@example.com' },
        Attachments: [{ Filename: 'a.txt', ContentType: 'text/plain', Base64Content: 'dGVzdA==' }],
      }],
    })
  })

  it('uses the configured sender and provider-prefixed fallback id', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      Messages: [{ Status: 'success', To: [{}] }],
    }), { status: 200 }))

    const result = await getMailjetChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    const request = (global.fetch as jest.Mock).mock.calls[0]
    expect(JSON.parse(String(request[1].body)).Messages[0]).toEqual(expect.objectContaining({
      From: { Email: 'fallback@example.com' },
    }))
    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: expect.stringMatching(/^mailjet:/) }))
  })

  it('treats a message-level error in a successful HTTP response as failed', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      Messages: [{
        Status: 'error',
        Errors: [{ ErrorMessage: 'sender rejected\r\nprovider-detail' }],
      }],
    }), { status: 200 }))

    const result = await getMailjetChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'MAILJET_SEND_FAILED: sender rejected provider-detail',
    }))
  })

  it('returns provider error details for non-success HTTP responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ ErrorMessage: 'bad credentials' }),
      { status: 401 },
    ))

    const result = await getMailjetChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'MAILJET_SEND_FAILED: bad credentials',
    }))
  })

  it('fails before making a request when recipients are missing', async () => {
    const result = await getMailjetChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'public-key', secretKey: 'private-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: [], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires at least one recipient',
    }))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
