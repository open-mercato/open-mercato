import { getBrevoChannelAdapter } from '../adapter'

describe('BrevoChannelAdapter', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ messageId: '<brevo-message-1>' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('maps html, text, reply-to, recipients, and attachments to the Brevo API', async () => {
    const adapter = getBrevoChannelAdapter()
    const result = await adapter.sendMessage({
      content: { html: '<p>Hello</p>', text: 'Hello', bodyFormat: 'html' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: {
        to: 'a@example.com, b@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        replyTo: 'reply@example.com',
        attachments: [{ filename: 'a.txt', content: 'dGVzdA==', contentType: 'text/plain' }],
      },
    })

    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: '<brevo-message-1>' }))
    const request = (global.fetch as jest.Mock).mock.calls[0]
    expect(request[0]).toBe('https://api.brevo.com/v3/smtp/email')
    expect(request[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'api-key': 'brevo-key' }),
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.parse(String(request[1].body))).toEqual({
      sender: { email: 'from@example.com' },
      to: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      subject: 'Hello',
      htmlContent: '<p>Hello</p>',
      textContent: 'Hello',
      replyTo: { email: 'reply@example.com' },
      attachment: [{ name: 'a.txt', content: 'dGVzdA==' }],
    })
  })

  it('uses the configured sender and provider-prefixed fallback id', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    const result = await getBrevoChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'fallback@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    const request = (global.fetch as jest.Mock).mock.calls[0]
    expect(JSON.parse(String(request[1].body))).toEqual(expect.objectContaining({
      sender: { email: 'fallback@example.com' },
    }))
    expect(result).toEqual(expect.objectContaining({ status: 'sent', externalMessageId: expect.stringMatching(/^brevo:/) }))
  })

  it('fails before making a request when recipients are missing', async () => {
    const result = await getBrevoChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: '  ', subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires at least one recipient',
    }))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails before making a request when the subject is missing', async () => {
    const result = await getBrevoChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'] },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: '[internal] Email send requires a subject',
    }))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns a sanitized provider error for non-success responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'invalid sender\r\nsecret-header' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ))

    const result = await getBrevoChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'BREVO_SEND_FAILED: invalid sender secret-header',
    }))
  })

  it('returns a stable failure when the provider request rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'))

    const result = await getBrevoChannelAdapter().sendMessage({
      content: { text: 'Hello' },
      credentials: { apiKey: 'brevo-key', fromAddress: 'from@example.com' },
      scope: { tenantId: 'tenant', organizationId: 'org' },
      metadata: { to: ['user@example.com'], subject: 'Hello' },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'BREVO_SEND_FAILED: network unavailable',
    }))
  })
})
